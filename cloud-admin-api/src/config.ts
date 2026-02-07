import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // Redis (optional, for multi-node rate limiting)
  redis: {
    url: process.env.REDIS_URL || '',
    host: process.env.REDIS_HOST || '',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0', 10),
    tls: process.env.REDIS_TLS === 'true',
  },

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production',
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '14d',

  // Security
  bcryptRounds: 12,
  captchaEnabled: process.env.CAPTCHA_ENABLED === 'true',
  captchaSecret: process.env.CAPTCHA_SECRET || '',

  // Rate Limiting
  rateLimits: {
    login: { max: 5, window: '1 minute' },
    loginHourly: { max: 20, window: '1 hour' },
    pairing: { max: 10, window: '1 minute' },
    api: { max: 60, window: '1 minute' },
    wsConnections: { max: 100, perTenant: true },
  },

  // Pairing
  pairCodeExpiry: 5 * 60 * 1000, // 5 minutes in ms
  pairCodeLength: 6,

  // Cleanup
  cleanupRetentionDays: 30,
  cleanupHour: 3, // 03:00 local time

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
