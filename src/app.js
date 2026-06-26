import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';
import pkg from '../package.json' with { type: 'json' };
import { EXPECTED_SCHEMA_VERSION, EXPECTED_SCHEMA_LABEL } from './config/schemaVersion.js';

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        
        GatewayIntentBits.Guilds,                        
        GatewayIntentBits.GuildMembers,                 

        GatewayIntentBits.GuildMessages,                
        GatewayIntentBits.GuildMessageReactions,        
        GatewayIntentBits.MessageContent,               
        GatewayIntentBits.DirectMessages,

        GatewayIntentBits.GuildVoiceStates,             

        GatewayIntentBits.GuildBans,                    
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Démarrage de TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      startupLog('Initialisation de la base de données...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      // Check database status and report
      const dbStatus = this.db.getStatus();
      if (dbStatus.isDegraded) {
        logger.warn('');
        logger.warn('╔═══════════════════════════════════════════════════════╗');
        logger.warn('║ ⚠️  BASE DE DONNÉES EN MODE DÉGRADÉ                 ║');
        logger.warn('║                                                       ║');
        logger.warn('║ Connexion : Stockage en mémoire (PostgreSQL indisponible)║');
        logger.warn('║ Persistance des données : DÉSACTIVÉE - données perdues au redémarrage    ║');
        logger.warn('║ Action requise : Corriger PostgreSQL et redémarrer le bot      ║');
        logger.warn('╚═══════════════════════════════════════════════════════╝');
        logger.warn('');
      } else {
        startupLog(`✅ Statut de la base de données : ${dbStatus.connectionType} (pleinement opérationnelle)`);
      }
      
      startupLog('Démarrage du serveur web...');
      this.startWebServer();
      
      startupLog('Chargement des commandes...');
      await loadCommands(this);
      startupLog(`Commandes chargées : ${this.commands.size}`);
      
      startupLog('Chargement des gestionnaires...');
      await this.loadHandlers();
      startupLog('Gestionnaires chargés');
      
      startupLog('Connexion à Discord...');
      await this.login(this.config.bot.token);
      startupLog('Connexion à Discord réussie');
      
      startupLog('Enregistrement des commandes slash...');
      await this.registerCommands();
      if (this.config.bot.multiGuild) {
        startupLog('Mode multi-serveur activé — commandes slash enregistrées globalement');
      } else if (this.config.bot.guildId) {
        startupLog(`Mode serveur unique — commandes slash enregistrées pour le serveur ${this.config.bot.guildId}`);
      }
      startupLog('Enregistrement des commandes slash terminé');
      
      const databaseMode = dbStatus.isDegraded
        ? 'Mode mémoire optionnel (réinitialisation des données après redémarrage)'
        : 'Connecté (données persistantes activées)';
      const handlerSummary = `${this.buttons.size} boutons, ${this.selectMenus.size} menus, ${this.modals.size} modales`;
      startupLog(
        `EN LIGNE ✅ | ${this.commands.size} commandes chargées | ${handlerSummary} | Base de données : ${databaseMode}`
      );
      
      this.setupCronJobs();
    } catch (error) {
      logger.error('Échec du démarrage du bot :', error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const configuredPort = Number(this.config.api?.port || process.env.PORT || 3000);
    const maxPortRetryAttempts = Number(process.env.PORT_RETRY_ATTEMPTS || 5);
    const host = process.env.WEB_HOST || '0.0.0.0';
    const corsOrigin = this.config.api?.cors?.origin || '*';
    
    app.use((req, res, next) => {
      const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
      const origin = req.headers.origin;
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    const requestCounts = new Map();
    const windowMs = 60000; 
    const maxRequests = this.config.api?.rateLimit?.max || 100;
    
    app.use((req, res, next) => {
      const ip = req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
      }
      
      const times = requestCounts.get(ip).filter(t => t > windowStart);
      
      if (times.length >= maxRequests) {
        return res.status(429).json({ error: 'Trop de requêtes' });
      }
      
      times.push(now);
      requestCounts.set(ip, times);
      next();
    });

    app.get('/health', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: 'inconnu' };
      const status = {
        status: 'sain',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: {
          connected: dbStatus.connectionType !== 'none',
          degraded: dbStatus.isDegraded,
          type: dbStatus.connectionType
        }
      };
      res.status(200).json(status);
    });

    app.get('/ready', (req, res) => {
      const dbStatus = this.db?.getStatus?.() || { isDegraded: true, connectionType: 'none' };
      const isReady = this.isReady() && !dbStatus.isDegraded;

      const metrics = {
        guildCount: this.guilds?.cache?.size ?? 0,
        commandCount: this.commands?.size ?? 0,
        database: {
          mode: dbStatus.connectionType,
          degraded: dbStatus.isDegraded,
          degradedReason: dbStatus.degradedReason ?? null,
        },
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        schemaLabel: EXPECTED_SCHEMA_LABEL,
      };

      if (isReady) {
        return res.status(200).json({
          ready: true,
          message: 'Le bot est prêt',
          metrics,
        });
      }

      res.status(503).json({
        ready: false,
        reason: !this.isReady() ? 'Bot non prêt' : 'Base de données dégradée',
        metrics,
      });
    });

    app.get('/', (req, res) => {
      res.status(200).json({ 
        message: 'Système TitanBot en ligne',
        version: pkg.version,
        timestamp: new Date().toISOString()
      });
    });

    const startServer = (port, attempt = 0) => {
      let hasStartedListening = false;
      const server = app.listen(port, host, () => {
        hasStartedListening = true;
        this.webServer = server;
        startupLog(`✅ Serveur web en cours d'exécution sur ${host}:${port}`);
        startupLog(`Point de contrôle santé : http://${host}:${port}/health`);
        startupLog(`Point de contrôle prêt : http://${host}:${port}/ready`);
      });

      server.on('error', (error) => {
        const errorCode = error?.code || 'ERREUR_INCONNUE';
        const errorMessage = error?.message || 'Erreur serveur inconnue';

        if (!hasStartedListening && errorCode === 'EADDRINUSE' && attempt < maxPortRetryAttempts) {
          const nextPort = port + 1;
          startupLog(`Le port ${port} est déjà utilisé. Essai du port ${nextPort}...`);
          setTimeout(() => startServer(nextPort, attempt + 1), 250);
          return;
        }

        if (hasStartedListening && errorCode === 'EADDRINUSE') {
          logger.warn(`Le serveur web a signalé un doublon de port sur ${host}:${port}, mais le bot reste en ligne.`);
          return;
        }

        logger.error(`❌ Erreur du serveur web sur le port ${port} (${errorCode}) : ${errorMessage}`);

        if (!hasStartedListening) {
          process.exit(1);
        }
      });
    };

    startServer(configuredPort, 0);
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
    cron.schedule('*/15 * * * *', () => this.updateAllCounters());
  }

  async updateAllCounters() {
    if (!this.db) {
      logger.warn('Base de données non disponible pour la mise à jour des compteurs');
      return;
    }
    
    for (const [guildId, guild] of this.guilds.cache) {
      try {
        const counters = await getServerCounters(this, guildId);
        const validCounters = [];
        const orphanedCounters = [];
        
        for (const counter of counters) {
          if (counter && counter.type && counter.channelId && counter.enabled !== false) {
            const channel = guild.channels.cache.get(counter.channelId);
            if (channel) {
              validCounters.push(counter);
              await updateCounter(this, guild, counter);
            } else {
              orphanedCounters.push(counter);
              logger.info(`Suppression du compteur orphelin ${counter.id} (type : ${counter.type}, salon supprimé : ${counter.channelId}) du serveur ${guildId}`);
            }
          }
        }
        
        if (orphanedCounters.length > 0) {
          await saveServerCounters(this, guildId, validCounters);
          logger.info(`Nettoyage de ${orphanedCounters.length} compteur(s) orphelin(s) effectué sur le serveur ${guildId} lors de la mise à jour planifiée`);
        }
      } catch (error) {
        logger.error(`Erreur lors de la mise à jour des compteurs pour le serveur ${guildId} :`, error);
      }
    }
  }

  async loadHandlers() {
    startupLog('Chargement des gestionnaires...');
    const handlers = [
      { path: 'events', type: 'default', required: true },
      { path: 'interactions', type: 'default', required: true }
    ];

    for (const handler of handlers) {
      try {
        startupLog(`Chargement du gestionnaire : ${handler.path}`);
        const module = await import(`./handlers/${handler.path}.js`);
        const loaderFn = handler.type.startsWith('named:')
          ? module[handler.type.split(':')[1]]
          : module.default;

        if (typeof loaderFn === 'function') {
          await loaderFn(this);
          startupLog(`✅ ${handler.path} chargé`);
        } else {
          throw new Error(`Chargeur invalide pour ${handler.path}`);
        }
      } catch (error) {
        if (handler.required) {
          logger.error(`❌ Échec du chargement du gestionnaire requis ${handler.path} :`, error.message);
          throw error;
        } else if (error.code !== 'MODULE_NOT_FOUND') {
          logger.warn(`⚠️ Échec du chargement du gestionnaire optionnel ${handler.path} :`, error.message);
        }
      }
    }
  }

  async registerCommands() {
    try {
      const { clientId, guildId, multiGuild } = this.config.bot;
      await registerSlashCommands(this, { clientId, guildId, multiGuild });
    } catch (error) {
      logger.error('Erreur lors de l’enregistrement des commandes :', error);
    }
  }

  async shutdown(reason = 'INCONNU') {
    shutdownLog(`Le bot s’arrête (${reason})...`);
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`🛑 Arrêt propre initié (${reason})`);
    logger.info(`${'='.repeat(60)}`);

    try {
      
      logger.info('Arrêt des tâches cron...');
      cron.getTasks().forEach(task => task.stop());
      logger.info('✅ Tâches cron arrêtées');

      if (this.db && this.db.db) {
        logger.info('Fermeture de la connexion à la base de données...');
        try {
          if (this.db.db.pool) {
            await this.db.db.pool.end();
            logger.info('✅ Connexion à la base de données fermée');
          }
        } catch (error) {
          logger.warn('Erreur lors de la fermeture du pool de base de données :', error.message);
        }
      }

      logger.info('Destruction du client Discord...');
      if (this.isReady()) {
        try {
          this.destroy();
          logger.info('✅ Client Discord détruit');
        } catch (error) {
          logger.warn('Avertissement lors de la destruction du client Discord (non critique) :', error.message);
        }
      }

      logger.info('✅ Arrêt propre terminé');
      shutdownLog('Bot arrêté avec succès.');
      process.exit(0);
    } catch (error) {
      logger.error('Erreur lors de l’arrêt propre :', error);
      process.exit(1);
    }
  }
}

try {
  const bot = new TitanBot();
  
  const setupShutdown = () => {
    process.on('SIGTERM', () => bot.shutdown('SIGTERM'));
    process.on('SIGINT', () => bot.shutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      logger.error('Exception non interceptée :', error);
      bot.shutdown('EXCEPTION_NON_INTERCEPTÉE');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      const code = reason?.code;
      if (code === 10062 || code === 40060 || code === 50027) {
        logger.warn('Rejet Discord récupérable :', reason?.message || reason);
        return;
      }

      logger.error('Promesse rejetée non gérée :', promise, 'raison :', reason);
      bot.shutdown('REJET_NON_GÉRÉ');
    });
  };
  
  setupShutdown();
  bot.start().catch((error) => {
    logger.error('Erreur fatale lors du démarrage du bot :', error);
    bot.shutdown('ERREUR_DE_DÉMARRAGE');
  });
} catch (error) {
  logger.error('Erreur fatale lors du démarrage du bot :', error);
  process.exit(1);
}

export default TitanBot;
