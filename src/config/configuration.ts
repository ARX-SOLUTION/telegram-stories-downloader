export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  admin: {
    telegramId: parseInt(process.env.ADMIN_TELEGRAM_ID ?? '0', 10),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID ?? '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH ?? '',
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    logLevel: process.env.TELEGRAM_LOG_LEVEL ?? 'warn',
    sessionString: process.env.TELEGRAM_SESSION_STRING ?? '',
    sessionFile: process.env.SESSION_FILE ?? 'session.txt',
  },
});
