const logger = require("../utils/logger");
const UserAgent = require("user-agents");
const { getProxyAgent } = require("./proxy");
const { Web3 } = require("web3");
const userAgent = new UserAgent().toString();
const axios = require("axios");

class gokiteAiAgent {
  constructor(account, proxy = null) {
    this.account = account;
    this.proxy = proxy;
    this.userAgent = userAgent;
    this.axiosConfig = {
      ...(this.proxy && { httpsAgent: getProxyAgent(this.proxy) }),
      timeout: 60000,
    };
    this.stats = {
      userXp: 0,
      rank: 0,
      dailyAgentAction: 0,
      totalAgentActions: 0,
      dailyAgentActionsXp: 0,
      totalAgentActionsXp: 0,
    };
    this.web3 = new Web3("https://api.avax.network/ext/bc/C/rpc");
    this.privateKey = this.account.privateKey;
    this.token = null;
    this.tokenExpiresOn = null;
  }

  generateRandomMessage(agentId) {
    const messagesByAgent = {
      deployment_R89FtdnXa7jWWHyr97WQ9LKG: [
        "What is Kite AI?",
        "What is proof of AI?",
      ],
      deployment_fseGykIvCLs3m9Nrpe9Zguy9: [
        "Price of bitcoin",
        "Top movers today",
      ],
      deployment_xkerjnnbdtazr9e15x3y7fi8: [
        "What do you think of this transaction? 0x252c02bded9a24426219248c9c1b065b752d3cf8bedf4902ed62245ab950895b",
      ],
    };

    const messages = messagesByAgent[agentId] || ["Default message"];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  async makeRequest(method, url, config = {}, retries = 5) {
    for (let i = 0; i < retries; i++) {
      try {
        const userAgent = new UserAgent().toString();
        const headers = {
          "User-Agent": userAgent,
          "Content-Type": "application/json",
          Connection: "keep-alive",
          Referer: "https://testnet.gokite.ai/",
          Origin: "https://testnet.gokite.ai/",
          ...config.headers,
        };
        const response = await axios({
          method,
          url,
          ...this.axiosConfig,
          ...config,
          headers,
        });
        return response;
      } catch (error) {
        logger.log(`{red-fg}Request failed: ${error.message}{/red-fg}`);
        logger.log(`{yellow-fg}Retrying... (${i + 1}/${retries}){/yellow-fg}`);
        await new Promise((resolve) => setTimeout(resolve, 12000));
      }
    }
    return null;
  }

  async generateSignature(getMessage) {
    const message = getMessage;
    const { signature } = this.web3.eth.accounts.sign(message, this.privateKey);
    return signature;
  }

  async getAuthTicket() {
    logger.log(
      `{cyan-fg}Getting auth ticket for ${this.account.address}...{/cyan-fg}`
    );
    const nonce = `timestamp_${Date.now()}`;
    const sendData = {
      nonce: nonce,
    };
    try {
      const response = await this.makeRequest(
        "POST",
        "https://api-kiteai.bonusblock.io/api/auth/get-auth-ticket",
        { data: sendData }
      );

      if (response && response.data.success === true) {
        logger.log(
          `{green-fg}Auth ticket message received for account ${this.account.address}{/green-fg}`
        );
        return { data: response.data, nonce: nonce };
      }
      logger.log(
        `{red-fg}Error getting auth ticket: ${response.data.message}{/red-fg}`
      );
      return null;
    } catch (error) {
      logger.log(
        `{red-fg}Error getting auth ticket: ${error.message}{/red-fg}`
      );
      return null;
    }
  }

  async loginWallet(signature, timestamp) {
    logger.log(
      `{cyan-fg}Logging in wallet ${this.account.address}...{/cyan-fg}`
    );
    const sendData = {
      blockchainName: "ethereum",
      signedMessage: signature,
      nonce: timestamp,
      referralId: "optionalReferral",
    };

    try {
      const response = await this.makeRequest(
        "POST",
        "https://api-kiteai.bonusblock.io/api/auth/eth",
        { data: sendData }
      );

      if (response && response.data.success === true) {
        logger.log(
          `{green-fg}Wallet ${this.account.address} logged in{/green-fg}`
        );
        this.token = response.data.payload.session.token;
        this.tokenExpiresOn = new Date(response.data.payload.session.expiresOn);
        return response.data;
      }
      return false;
    } catch (error) {
      logger.log(`{red-fg}Error logging in wallet: ${error.message}{/red-fg}`);
      return null;
    }
  }

  async getDataAccounts() {
    logger.log(`{cyan-fg}Getting data for ${this.account.address}{/cyan-fg}`);
    const headers = {
      "x-auth-token": this.token,
    };

    try {
      const response = await this.makeRequest(
        "GET",
        "https://api-kiteai.bonusblock.io/api/kite-ai/get-status",
        { headers: headers }
      );

      if (response && response.data.success === true) {
        logger.log(
          `{green-fg}Data retrieved for ${this.account.address}{/green-fg}`
        );
        this.stats.userXp = response.data.payload.userXp || 0;
        this.stats.rank = response.data.payload.rank || 0;
        this.stats.dailyAgentAction =
          response.data.payload.dailyAgentAction || 0;
        this.stats.totalAgentActions =
          response.data.payload.totalAgentActions || 0;
        this.stats.dailyAgentActionsXp =
          response.data.payload.dailyAgentActionsXp || 0;
        this.stats.totalAgentActionsXp =
          response.data.payload.totalAgentActionsXp || 0;
        return response.data;
      }
      return false;
    } catch (error) {
      logger.log(`{red-fg}Error getting data: ${error.message}{/red-fg}`);
      return null;
    }
  }

  async refreshOrGetData() {
    if (this.tokenExpiresOn && new Date() < this.tokenExpiresOn) {
      logger.log(
        `{green-fg}Token still valid, fetching data directly{/green-fg}`
      );
      return await this.getDataAccounts();
    } else {
      logger.log(`{red-fg}Token expired, logging in again{/red-fg}`);
      return await this.proccesingGetDataAccount();
    }
  }

  async proccesingGetDataAccount() {
    try {
      const authTicket = await this.getAuthTicket();
      if (!authTicket) return false;

      const signature = await this.generateSignature(authTicket.data.payload);
      if (!signature) return false;

      const login = await this.loginWallet(signature, authTicket.nonce);
      if (!login) return false;

      return await this.getDataAccounts();
    } catch (error) {
      logger.log(
        `{red-fg}Error processing account ${this.account.address}: ${error.message}{/red-fg}`
      );
      return false;
    }
  }

  async chatStream(agent_id) {
    const formattedAgentId = agent_id.replace(/_/g, "-");
    const url = `https://${formattedAgentId}.stag-vxzy.zettablock.com/main`;

    try {
      logger.log(`{cyan-fg}Chatting with agent: ${agent_id}{/cyan-fg}`);
      const startTime = Date.now();
      let ttft = null;
      let fullResponse = "";
      const message = this.generateRandomMessage(agent_id);

      const response = await this.makeRequest("POST", url, {
        data: { message, stream: true },
        responseType: "stream",
      });

      if (!response) {
        logger.log(`{red-fg}Error: No response from streaming API{/red-fg}`);
        return;
      }

      response.data.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (!text || text === "data:" || text === "data: [DONE]") {
          return;
        }

        try {
          const cleanText = text.replace(/^data:\s*/, "");
          if (cleanText.startsWith("{") && cleanText.endsWith("}")) {
            const jsonData = JSON.parse(cleanText);
            if (jsonData.choices && jsonData.choices.length > 0) {
              const delta = jsonData.choices[0].delta;
              if (delta && "content" in delta && delta.content !== null) {
                fullResponse += delta.content;
              }
            }
          }
        } catch (err) {}
      });

      response.data.on("end", async () => {
        if (fullResponse.trim().length === 0) {
          logger.log(
            `{red-fg}Warning: No response received from agent ${agent_id}{/red-fg}`
          );
          fullResponse = "No response received";
        }
        const totalTime = Date.now() - startTime;
        logger.log(
          `{green-fg}Stream done ${agent_id}, received: ${fullResponse}{/green-fg}`
        );
        await this.chatAgent(message, fullResponse, agent_id, ttft, totalTime);
      });
    } catch (error) {
      logger.log(`{red-fg}Error when stream chat: ${error.message}{/red-fg}`);
    }
  }

  async chatAgent(requestText, responseText, agent_id, ttft, total_time) {
    const url = "https://quests-usage-dev.prod.zettablock.com/api/report_usage";
    const sendData = {
      wallet_address: this.account.address,
      agent_id: agent_id,
      request_text: requestText,
      response_text: responseText,
      ttft: ttft,
      total_time: total_time,
      request_metadata: {},
    };

    try {
      const response = await this.makeRequest("POST", url, { data: sendData });
      if (
        response &&
        response.data.message === "Usage report successfully recorded"
      ) {
        logger.log(
          `{green-fg}Chat recorded successfully for agent: ${agent_id}{/green-fg}`
        );
      }
    } catch (error) {
      logger.log(
        `{red-fg}Error saving chat for agent ${agent_id}: ${error.message}{/red-fg}`
      );
    }
  }

  async startAutoChatLoop() {
    const agents = [
      "deployment_R89FtdnXa7jWWHyr97WQ9LKG",
      "deployment_fseGykIvCLs3m9Nrpe9Zguy9",
      "deployment_xkerjnnbdtazr9e15x3y7fi8",
    ];

    while (true) {
      for (const agent of agents) {
        await this.chatStream(agent);
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }

      logger.log(
        `{yellow-fg}Waiting 10 minutes before next chat...{/yellow-fg}`
      );
      await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
    }
  }
}

module.exports = gokiteAiAgent;
