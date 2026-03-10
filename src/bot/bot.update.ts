import { Injectable, Logger } from '@nestjs/common';
import { Command, Help, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { UserClientService } from '../user-client/user-client.service';

interface TelegrafContext {
  from?: { id: number; username?: string; first_name?: string };
  message?: { text?: string };
  reply: (text: string) => Promise<unknown>;
}

@Update()
@Injectable()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userClientService: UserClientService,
  ) {}

  // ─── /start ───────────────────────────────────────────────────────────────

  @Start()
  async onStart(ctx: TelegrafContext): Promise<void> {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
      `👋 Hello, ${name}!\n\n` +
        `I am a combined Telegram Bot + User Bot.\n\n` +
        `📋 <b>Commands:</b>\n` +
        `/start — show this message\n` +
        `/help — list all commands\n` +
        `/status — user-client login state\n` +
        `/login — begin user-client login flow\n` +
        `/dialogs — list recent chats (requires login)`,
    );
  }

  // ─── /help ────────────────────────────────────────────────────────────────

  @Help()
  async onHelp(ctx: TelegrafContext): Promise<void> {
    await ctx.reply(
      `📖 <b>Available commands</b>\n\n` +
        `/status — check user-client authorization status\n` +
        `/login — start the login flow\n` +
        `/dialogs — list recent chats of the user account\n\n` +
        `<b>Login flow (via the REST API):</b>\n` +
        `1. POST /user-client/login/initiate\n` +
        `2. POST /user-client/login/submit-phone  { "phoneNumber": "+998..." }\n` +
        `3. POST /user-client/login/submit-code   { "code": "12345" }\n` +
        `4. POST /user-client/login/submit-password { "password": "..." }  ← if 2FA\n` +
        `5. GET  /user-client/status  ← poll until "authorized"`,
    );
  }

  // ─── /status ──────────────────────────────────────────────────────────────

  @Command('status')
  async onStatus(ctx: TelegrafContext): Promise<void> {
    const status = await this.userClientService.getStatus();
    const icon = status.authorized ? '✅' : '⚠️';
    await ctx.reply(
      `${icon} <b>User Client Status</b>\n\n` +
        `Login state: <code>${status.loginState}</code>\n` +
        `Connected: ${status.connected ? 'Yes' : 'No'}\n` +
        `Authorized: ${status.authorized ? 'Yes' : 'No'}`,
    );
  }

  // ─── /login ───────────────────────────────────────────────────────────────

  @Command('login')
  async onLogin(ctx: TelegrafContext): Promise<void> {
    const result = await this.userClientService.initiateLogin();
    await ctx.reply(
      `🔑 <b>Login Flow</b>\n\n` +
        `State: <code>${result.state}</code>\n\n` +
        `${result.message}\n\n` +
        `Use the REST API to continue:\n` +
        `POST /user-client/login/submit-phone`,
    );
  }

  // ─── /dialogs ─────────────────────────────────────────────────────────────

  @Command('dialogs')
  async onDialogs(ctx: TelegrafContext): Promise<void> {
    try {
      const dialogs = await this.userClientService.getDialogs();
      if (dialogs.length === 0) {
        await ctx.reply('No dialogs found.');
        return;
      }
      const lines = dialogs
        .slice(0, 20)
        .map((d, i) => {
          const username = d.username ? `@${d.username}` : d.id;
          return `${i + 1}. ${d.name || 'Unnamed'} — ${username}`;
        })
        .join('\n');
      await ctx.reply(`📋 <b>Recent dialogs</b>\n\n${lines}`);
    } catch {
      await ctx.reply(
        '❌ Not authorized. Use /login or POST /user-client/login/initiate first.',
      );
    }
  }

  // ─── Text handler ─────────────────────────────────────────────────────────

  @On('text')
  async onText(ctx: TelegrafContext): Promise<void> {
    const text = ctx.message?.text?.toLowerCase() ?? '';
    const username = ctx.from?.username ?? ctx.from?.first_name ?? 'user';

    this.logger.log(`Bot received from @${username}: ${text}`);

    if (
      text.includes('hello') ||
      text.includes('salom') ||
      text.includes('привет')
    ) {
      await ctx.reply(`👋 Hello, @${username}!`);
    } else if (text.includes('bye') || text.includes('xayr')) {
      await ctx.reply(`👋 Goodbye, @${username}!`);
    } else if (text.includes('ping')) {
      await ctx.reply('🏓 Pong!');
    }
    // All other text is silently ignored
  }
}
