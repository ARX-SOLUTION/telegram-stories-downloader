export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID ?? '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH ?? '',
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    sessionFile: process.env.SESSION_FILE ?? 'session.txt',
  },
});
