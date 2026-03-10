import { Injectable, Logger } from '@nestjs/common';
import { Command, Help, InjectBot, On, Start, Update } from 'nestjs-telegraf';
import { Input, Markup, Telegraf } from 'telegraf';
import { UserClientService } from '../user-client/user-client.service';
import { USER_CLIENT_API_ROUTES } from '../user-client/user-client.constants';
import {
  DownloadedStoryMedia,
  LoginFlowResponse,
  LoginState,
  UserClientStatus,
} from '../user-client/user-client.types';

interface TelegrafContext {
  chat?: { id: number };
  from?: { id: number; username?: string; first_name?: string };
  message?: { text?: string; contact?: { phone_number: string } };
  reply: (text: string, extra?: object) => Promise<unknown>;
  replyWithDocument: (document: object, extra?: object) => Promise<unknown>;
  replyWithPhoto: (photo: object, extra?: object) => Promise<unknown>;
  replyWithVideo: (video: object, extra?: object) => Promise<unknown>;
}

@Update()
@Injectable()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);
  private activeLoginChatId: number | null = null;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userClientService: UserClientService,
  ) {}

  @Start()
  async onStart(ctx: TelegrafContext): Promise<void> {
    const name = ctx.from?.first_name ?? 'do‘st';
    await this.replyHtml(ctx, this.formatStartMessage(name));
  }

  @Help()
  async onHelp(ctx: TelegrafContext): Promise<void> {
    await this.replyHtml(ctx, this.formatHelpMessage());
  }

  @Command('status')
  async onStatus(ctx: TelegrafContext): Promise<void> {
    const status = this.userClientService.getStatus();
    await this.replyHtml(
      ctx,
      this.formatStatusMessage(status),
      this.getReplyMarkup(status.loginState),
    );
  }

  @Command('login')
  async onLogin(ctx: TelegrafContext): Promise<void> {
    const chatId = this.getChatId(ctx);

    if (this.isLoginLockedToAnotherChat(chatId)) {
      await this.replyHtml(
        ctx,
        '🔒 <b>Login band</b>\n\nLogin jarayoni boshqa chatda davom etyapti.',
      );
      return;
    }

    const result = this.userClientService.initiateLogin();
    this.captureLoginChat(chatId, result.state);

    await this.replyHtml(
      ctx,
      this.formatLoginFlowMessage(result),
      this.getReplyMarkup(result.state),
    );
  }

  @Command('dialogs')
  async onDialogs(ctx: TelegrafContext): Promise<void> {
    try {
      const dialogs = await this.userClientService.getDialogs();

      if (dialogs.length === 0) {
        await this.replyHtml(ctx, '📭 <b>Dialoglar topilmadi</b>');
        return;
      }

      await this.replyHtml(ctx, this.formatDialogsMessage(dialogs));
    } catch (error) {
      await this.replyHtml(
        ctx,
        `❌ <b>Dialoglarni olish olmadi</b>\n\n${this.escapeHtml(this.getErrorMessage(error))}\n\n${this.getStatePrompt(
          this.userClientService.getLoginState(),
        )}`,
      );
    }
  }

  @Command('stories')
  async onStories(ctx: TelegrafContext): Promise<void> {
    const username = this.extractStoriesUsername(ctx.message?.text);
    if (!username) {
      await this.replyHtml(
        ctx,
        'ℹ️ <b>Foydalanish</b>\n\nOddiy username yuboring:\n<code>durov</code>\n<code>@durov</code>\n<code>https://t.me/durov</code>',
      );
      return;
    }

    await this.handleStoriesRequest(ctx, username);
  }

  @On('contact')
  async onContact(ctx: TelegrafContext): Promise<void> {
    const phoneNumber = ctx.message?.contact?.phone_number;
    if (!phoneNumber) {
      return;
    }

    if (!this.shouldHandleLoginInput(ctx)) {
      await this.replyHtml(
        ctx,
        'ℹ️ <b>Kontakt qabul qilinmadi</b>\n\nInteraktiv login yoqilmagan. End-user login qilmaydi.',
      );
      return;
    }

    await this.handleLoginInput(ctx, phoneNumber);
  }

  @On('text')
  async onText(ctx: TelegrafContext): Promise<void> {
    const rawText = ctx.message?.text?.trim() ?? '';
    if (!rawText) {
      return;
    }

    if (rawText.startsWith('/')) {
      return;
    }

    const username = ctx.from?.username ?? ctx.from?.first_name ?? 'user';
    this.logger.log(`Bot received from @${username}: ${rawText}`);

    if (this.shouldHandleLoginInput(ctx)) {
      await this.handleLoginInput(ctx, rawText);
      return;
    }

    const storyUsername = this.extractMentionOrLinkUsername(rawText);
    if (storyUsername) {
      await this.handleStoriesRequest(ctx, storyUsername);
      return;
    }

    const text = rawText.toLowerCase();

    if (
      text.includes('hello') ||
      text.includes('salom') ||
      text.includes('привет')
    ) {
      await this.replyHtml(
        ctx,
        `👋 Salom, <b>${this.escapeHtml(username)}</b>!`,
      );
      return;
    }

    if (text.includes('bye') || text.includes('xayr')) {
      await this.replyHtml(
        ctx,
        `👋 Xayr, <b>${this.escapeHtml(username)}</b>!`,
      );
      return;
    }

    if (text.includes('ping')) {
      await this.replyHtml(ctx, '🏓 <b>Pong!</b>');
      return;
    }

    if (this.isPlainUsername(rawText)) {
      await this.handleStoriesRequest(ctx, rawText);
    }
  }

  private async handleLoginInput(
    ctx: TelegrafContext,
    value: string,
  ): Promise<void> {
    try {
      let result: LoginFlowResponse;
      const currentState = this.userClientService.getLoginState();

      switch (currentState) {
        case 'waiting_phone':
          result = await this.userClientService.submitPhone(value);
          break;
        case 'waiting_code':
          result = await this.userClientService.submitCode(value);
          break;
        case 'waiting_password':
          result = await this.userClientService.submitPassword(value);
          break;
        default:
          await this.replyHtml(
            ctx,
            'ℹ️ <b>Login aktiv emas</b>\n\nEnd-user login qilmaydi. Kerak bo‘lsa admin sessionni yangilaydi.',
          );
          return;
      }

      this.captureLoginChat(this.getChatId(ctx), result.state);

      await this.replyHtml(
        ctx,
        this.formatLoginFlowMessage(result),
        this.getReplyMarkup(result.state),
      );
    } catch (error) {
      const currentState = this.userClientService.getLoginState();
      await this.replyHtml(
        ctx,
        `❌ <b>Xatolik</b>\n\n${this.escapeHtml(this.getErrorMessage(error))}\n\n${this.getStatePrompt(
          currentState,
        )}`,
        this.getReplyMarkup(currentState),
      );
    }
  }

  private formatStartMessage(name: string): string {
    return [
      `👋 <b>Salom, ${this.escapeHtml(name)}!</b>`,
      '',
      'Men Telegram Bot + User Bot yordamchisiman.',
      '',
      '<b>Buyruqlar</b>',
      '/start — boshlang‘ich xabar',
      '/help — foydalanish bo‘yicha yordam',
      '/status — user-client holati',
      '/dialogs — so‘nggi chatlar',
      'username yuboring — barcha storylarni yuklash',
    ].join('\n');
  }

  private formatHelpMessage(): string {
    return [
      '📘 <b>Yordam</b>',
      '',
      '<b>Story yuklash</b>',
      'Oddiy username yuboring:',
      '<code>durov</code>',
      '<code>@durov</code>',
      '<code>https://t.me/durov</code>',
      'Bot active + archived storylarni olishga urinadi.',
      '',
      '<b>Session</b>',
      'End-user login qilmaydi.',
      'Bot owner serverda <code>TELEGRAM_SESSION_STRING</code> yoki <code>SESSION_FILE</code> sozlashi kerak.',
      '',
      '<b>REST API</b>',
      `POST <code>${USER_CLIENT_API_ROUTES.initiateLogin}</code>`,
      `POST <code>${USER_CLIENT_API_ROUTES.submitPhone}</code>`,
      `POST <code>${USER_CLIENT_API_ROUTES.submitCode}</code>`,
      `POST <code>${USER_CLIENT_API_ROUTES.submitPassword}</code>`,
      `GET <code>${USER_CLIENT_API_ROUTES.status}</code>`,
      `GET <code>${USER_CLIENT_API_ROUTES.dialogs}</code>`,
    ].join('\n');
  }

  private formatStatusMessage(status: UserClientStatus): string {
    const icon =
      status.loginState === 'authorized'
        ? '✅'
        : status.loginState === 'error'
          ? '❌'
          : '⚠️';

    const lines = [
      `${icon} <b>User Client Status</b>`,
      '',
      `Holat: <code>${status.loginState}</code>`,
      `Ulangan: ${status.connected ? 'Ha' : 'Yo‘q'}`,
      `Ruxsat: ${status.authorized ? 'Ha' : 'Yo‘q'}`,
    ];

    if (status.lastError) {
      lines.push(
        '',
        `Oxirgi xatolik: <code>${this.escapeHtml(status.lastError)}</code>`,
      );
    }

    const prompt = this.getStatePrompt(status.loginState);
    if (prompt) {
      lines.push('', prompt);
    }

    return lines.join('\n');
  }

  private formatLoginFlowMessage(result: LoginFlowResponse): string {
    const lines = [
      '🔐 <b>Login Flow</b>',
      '',
      `Holat: <code>${result.state}</code>`,
      '',
      this.escapeHtml(result.message),
    ];

    if (result.lastError) {
      lines.push(
        '',
        `Xatolik: <code>${this.escapeHtml(result.lastError)}</code>`,
      );
    }

    const prompt = this.getStatePrompt(result.state);
    if (prompt) {
      lines.push('', prompt);
    }

    return lines.join('\n');
  }

  private formatDialogsMessage(
    dialogs: { id: string; name: string; username: string }[],
  ): string {
    const lines = dialogs.slice(0, 20).map((dialog, index) => {
      const name = this.escapeHtml(dialog.name || 'Nomsiz');
      const target = dialog.username
        ? `@${this.escapeHtml(dialog.username)}`
        : `<code>${this.escapeHtml(dialog.id)}</code>`;

      return `${index + 1}. ${name} — ${target}`;
    });

    return ['📋 <b>So‘nggi dialoglar</b>', '', ...lines].join('\n');
  }

  private getStatePrompt(state: LoginState): string {
    switch (state) {
      case 'idle':
        return 'Bot owner sessionni sozlashi kerak. End-user login shart emas.';
      case 'waiting_phone':
        return 'Telefon raqamingizni <code>+998901234567</code> ko‘rinishida yuboring yoki pastdagi tugmani bosing.';
      case 'waiting_code':
        return 'Telegram yuborgan kodni shu chatga yuboring. Masalan: <code>12345</code>';
      case 'waiting_password':
        return '2 bosqichli parolni shu chatga yuboring.';
      case 'authorized':
        return 'Akkaunt ulandi. Endi <code>/dialogs</code>, <code>/stories</code> va <code>/status</code> ishlaydi.';
      case 'error':
        return 'Session bilan muammo bor. Bot owner sessionni yangilashi kerak.';
      default:
        return '';
    }
  }

  private getReplyMarkup(state: LoginState): object {
    if (state === 'waiting_phone') {
      return Markup.keyboard([
        [Markup.button.contactRequest('📱 Telefon raqamni yuborish')],
      ])
        .resize()
        .oneTime();
    }

    if (this.isInteractiveState(state)) {
      return Markup.removeKeyboard();
    }

    return Markup.removeKeyboard();
  }

  private async replyHtml(
    ctx: TelegrafContext,
    text: string,
    extra: object = {},
  ): Promise<void> {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...extra,
    });
  }

  private async handleStoriesRequest(
    ctx: TelegrafContext,
    username: string,
  ): Promise<void> {
    const status = this.userClientService.getStatus();
    if (!status.authorized) {
      await this.replyHtml(
        ctx,
        '🔒 <b>User session tayyor emas</b>\n\nEnd-user login qilmaydi. Bot owner serverda <code>TELEGRAM_SESSION_STRING</code> yoki <code>SESSION_FILE</code> sozlashi kerak.',
      );
      return;
    }

    const chatId = this.getChatId(ctx);
    if (!chatId) {
      await this.replyHtml(ctx, '❌ <b>Chat aniqlanmadi</b>');
      return;
    }

    const normalizedUsername = this.normalizeDisplayUsername(username);

    await this.replyHtml(
      ctx,
      `⏳ <b>Barcha storylar yuklanmoqda...</b>\n\nManba: <code>@${this.escapeHtml(
        normalizedUsername,
      )}</code>\nTuri: <code>active + archived</code>`,
    );

    void this.processStoriesRequest(chatId, normalizedUsername);
  }

  private extractStoriesUsername(text?: string): string | null {
    if (!text) {
      return null;
    }

    const match = text.match(/^\/stories(?:@\w+)?(?:\s+(.+))?$/s);
    const username = match?.[1]?.trim();
    return username || null;
  }

  private extractMentionOrLinkUsername(text: string): string | null {
    const trimmedText = text.trim();

    if (/^https?:\/\/t\.me\/[a-zA-Z0-9_]{5,32}\/?$/i.test(trimmedText)) {
      return trimmedText;
    }

    if (/^@[a-zA-Z0-9_]{5,32}$/.test(trimmedText)) {
      return trimmedText;
    }

    const mentionMatch = trimmedText.match(/@([a-zA-Z0-9_]{5,32})/);
    if (mentionMatch) {
      return mentionMatch[0];
    }

    const urlMatch = trimmedText.match(
      /https?:\/\/t\.me\/([a-zA-Z0-9_]{5,32})\/?/i,
    );
    if (urlMatch) {
      return urlMatch[0];
    }

    return null;
  }

  private isPlainUsername(text: string): boolean {
    return /^[a-zA-Z0-9_]{5,32}$/.test(text.trim());
  }

  private normalizeDisplayUsername(username: string): string {
    return username
      .trim()
      .replace(/^https?:\/\/t\.me\//i, '')
      .replace(/^@+/, '');
  }

  private async sendStoryMedia(
    ctx: TelegrafContext,
    story: DownloadedStoryMedia,
  ): Promise<void> {
    const inputFile = Input.fromBuffer(story.buffer, story.filename);

    if (story.mimeType.startsWith('image/')) {
      await ctx.replyWithPhoto(inputFile);
      return;
    }

    if (story.mimeType.startsWith('video/')) {
      await ctx.replyWithVideo(inputFile);
      return;
    }

    await ctx.replyWithDocument(inputFile);
  }

  private async processStoriesRequest(
    chatId: number,
    normalizedUsername: string,
  ): Promise<void> {
    try {
      const stories =
        await this.userClientService.getUserStories(normalizedUsername);

      if (stories.length === 0) {
        await this.sendHtmlToChat(
          chatId,
          '⚠️ Bu foydalanuvchida story topilmadi',
        );
        return;
      }

      for (const story of stories) {
        await this.sendStoryMediaToChat(chatId, story);
      }

      await this.sendHtmlToChat(
        chatId,
        `✅ <b>${stories.length} ta story yuklandi</b>`,
      );
    } catch (error) {
      this.logger.error(
        `Story download failed for @${normalizedUsername}: ${this.getErrorMessage(error)}`,
      );
      await this.sendHtmlToChat(
        chatId,
        `❌ <b>Xatolik</b>\n\n${this.escapeHtml(this.getErrorMessage(error))}`,
      );
    }
  }

  private async sendHtmlToChat(chatId: number, text: string): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
    });
  }

  private async sendStoryMediaToChat(
    chatId: number,
    story: DownloadedStoryMedia,
  ): Promise<void> {
    const inputFile = Input.fromBuffer(story.buffer, story.filename);

    if (story.mimeType.startsWith('image/')) {
      await this.bot.telegram.sendPhoto(chatId, inputFile);
      return;
    }

    if (story.mimeType.startsWith('video/')) {
      await this.bot.telegram.sendVideo(chatId, inputFile);
      return;
    }

    await this.bot.telegram.sendDocument(chatId, inputFile);
  }

  private captureLoginChat(chatId: number | null, state: LoginState) {
    if (!chatId) {
      return;
    }

    if (this.isInteractiveState(state)) {
      this.activeLoginChatId = chatId;
      return;
    }

    this.activeLoginChatId = null;
  }

  private shouldHandleLoginInput(ctx: TelegrafContext): boolean {
    if (!this.userClientService.isWaitingForLoginInput()) {
      return false;
    }

    const chatId = this.getChatId(ctx);
    if (!chatId) {
      return false;
    }

    if (this.activeLoginChatId === null) {
      this.activeLoginChatId = chatId;
      return true;
    }

    return this.activeLoginChatId === chatId;
  }

  private isLoginLockedToAnotherChat(chatId: number | null): boolean {
    return (
      this.userClientService.isWaitingForLoginInput() &&
      this.activeLoginChatId !== null &&
      chatId !== null &&
      this.activeLoginChatId !== chatId
    );
  }

  private isInteractiveState(state: LoginState): boolean {
    return (
      state === 'waiting_phone' ||
      state === 'waiting_code' ||
      state === 'waiting_password'
    );
  }

  private getChatId(ctx: TelegrafContext): number | null {
    return ctx.chat?.id ?? ctx.from?.id ?? null;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Noma’lum xatolik';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
