require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const mongoose = require('mongoose');
const { logger } = require('./utils/logger');
const config = require('./config');
const CommandHandler = require('./handlers/commandHandler');
const EventHandler = require('./handlers/eventHandler');
const HealthService = require('./services/HealthService');
const cache = require('./cache/CacheService');
const AIService = require('./services/AIService');
const MemoryService = require('./services/MemoryService');
const MonitorService = require('./services/MonitorService');
const AISecurityService = require('./services/AISecurityService');
const PaymentService = require('./services/PaymentService');
const FraudDetectionService = require('./services/FraudDetectionService');
const ProBotMonitorService = require('./services/ProBotMonitorService');
const WebhookServer = require('./webhook/server');
const AIChatSessionManager = require('./services/AIChatSessionManager');
const BackupService = require('./services/BackupService');
const AlertService = require('./services/AlertService');

const CLEANUP_INTERVAL = 300000; // 5 minutes

class MarketAIBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
    });

    this.commands = new CommandHandler(this.client);
    this.events = new EventHandler(this.client);
    this.healthService = new HealthService(this.client);
    this.aiChatSessionManager = new AIChatSessionManager(this.client);
    this.client.aiChatSessionManager = this.aiChatSessionManager;
    this.logger = logger;
    this._cleanupTimer = null;
  }

  validateEnv() {
    const errors = [];

    if (!process.env.DISCORD_TOKEN) errors.push('DISCORD_TOKEN (Discord Bot Token)');
    if (!process.env.CLIENT_ID) errors.push('CLIENT_ID (Discord Application ID)');
    if (!process.env.MONGODB_URI) errors.push('MONGODB_URI (MongoDB Connection)');
    if (!process.env.PROBOT_ACCOUNT_ID) errors.push('PROBOT_ACCOUNT_ID (ProBot Account for Payment Escrow)');

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      errors.push('GROQ_API_KEY (Groq AI Key)');
    } else if (groqKey.includes('PLACE_YOUR') || groqKey.includes('YOUR_KEY') || groqKey.includes('EXAMPLE')) {
      errors.push('GROQ_API_KEY is a placeholder! Get a real key from https://console.groq.com/keys');
    } else if (!groqKey.startsWith('gsk_')) {
      errors.push('GROQ_API_KEY must start with "gsk_" - get a valid key from https://console.groq.com/keys');
    }

    if (errors.length > 0) {
      const msg = [
        '╔══════════════════════════════════════════════════╗',
        '║             ❌ FATAL: Configuration Error        ║',
        '╠══════════════════════════════════════════════════╣',
        ...errors.map(e => `║  • ${e.padEnd(42)}║`),
        '╠══════════════════════════════════════════════════╣',
        '║  Fix your .env file and restart the bot.         ║',
        '╚══════════════════════════════════════════════════╝',
      ].join('\n');
      throw new Error(msg);
    }
  }

  setupGlobalHandlers() {
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack,
      });
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    process.on('uncaughtExceptionMonitor', (error) => {
      logger.error('Uncaught exception monitor', { error: error.message });
    });

    process.on('warning', (warning) => {
      if (warning.name === 'DeprecationWarning') return;
      logger.warn('Process warning', { name: warning.name, message: warning.message, stack: warning.stack });
    });

    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  startMemoryCleanup() {
    this.commands.startCleanup(CLEANUP_INTERVAL);

    this._cleanupTimer = setInterval(() => {
      try {
        MemoryService.clearAllCaches();
      } catch (err) { logger.error('Unhandled error in index.js', { error: err?.message }) }
    }, CLEANUP_INTERVAL);
  }

  stopMemoryCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this.commands.stopCleanup();
  }

  async shutdown(signal) {
    this.logger.info(`Received ${signal}, shutting down gracefully...`);
    try {
      MonitorService.stop();
      ProBotMonitorService.stop();
      if (this.webhookServer) await this.webhookServer.stop();
      this.healthService.stop();
      this.stopMemoryCleanup();

      if (this.client.isReady()) {
        this.client.user.setPresence({ activities: [{ name: '🔄 جاري إيقاف التشغيل...', type: 0 }], status: 'dnd' });
      }

      AIService.destroy();
      AISecurityService.stop();
      MemoryService.destroy();
      this.aiChatSessionManager.destroy();
      BackupService.stop();
      AlertService.stop();
      PaymentService.destroy();
      FraudDetectionService.stop();

      this.client.destroy();

      await cache.disconnect().catch(() => {});
      await mongoose.connection.close().catch(() => {});

      this.logger.info('Shutdown complete');
    } catch (err) {
      this.logger.error('Error during shutdown', { error: err.message });
    }
    process.exit(0);
  }

  async start() {
    try {
      this.logger.info('Starting Market AI Bot...');

      this.setupGlobalHandlers();
      this.validateEnv();

      await this.connectDatabase();
      await this.loadCommands();
      await this.loadEvents();

      this.client.commands = this.commands;

      MonitorService.start();
      this.startMemoryCleanup();
      this.healthService.start();

      this.webhookServer = new WebhookServer();
      await this.webhookServer.start().catch(err => logger.warn('Webhook server failed to start', { error: err.message }));
      ProBotMonitorService.start();
      BackupService.setClient(this.client);
      BackupService.initialize();
      AlertService.setClient(this.client);
      AlertService.initialize();

      await this.client.login(config.discord.token);

      this.aiChatSessionManager.initialize();
      this.logger.info('AI Chat Session Manager initialized');

      this.logger.info('Bot started successfully!');
    } catch (error) {
      this.logger.error('Failed to start bot', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  }

  async connectDatabase() {
    try {
      await mongoose.connect(config.mongodb.uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000,
        retryWrites: true,
        retryReads: true,
      });

      this.logger.info('Connected to MongoDB');

      const { setupMongoMonitoring } = require('./middleware/mongoMonitor');
      setupMongoMonitoring(mongoose);

      mongoose.connection.on('error', (err) => {
        this.logger.error('MongoDB connection error', { error: err.message });
        AlertService._state.mongoConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        this.logger.warn('MongoDB disconnected');
        AlertService._state.mongoConnected = false;
      });
    } catch (error) {
      this.logger.error('Failed to connect to MongoDB', { error: error.message });
      throw error;
    }
  }

  async loadCommands() {
    await this.commands.loadCommands();
  }

  async loadEvents() {
    await this.events.loadEvents();
  }
}

const bot = new MarketAIBot();
bot.start();

module.exports = bot;
