import { Injectable, Logger } from '@nestjs/common';
import {
  Action,
  Command,
  Help,
  InjectBot,
  On,
  Start,
  Update,
} from 'nestjs-telegraf';
import { Input, Markup, Telegraf } from 'telegraf';
import { ReferralService } from '../referral/referral.service';
import { UserClientService } from '../user-client/user-client.service';
import { USER_CLIENT_API_ROUTES } from '../user-client/user-client.constants';
import {
  LoginFlowResponse,
  LoginState,
  PaginatedStoriesResult,
  StoryDownloadResult,
  UserClientStatus,
} from '../user-client/user-client.types';

interface TelegrafContext {
  chat?: { id: number };
  from?: { id: number; username?: string; first_name?: string };
  message?: { text?: string; contact?: { phone_number: string } };
  callbackQuery?: { data?: string; message?: { chat?: { id: number } } };
  botInfo?: { username?: string };
  match?: RegExpExecArray;
  reply: (text: string, extra?: object) => Promise<unknown>;
  replyWithDocument: (document: object, extra?: object) => Promise<unknown>;
  replyWithPhoto: (photo: object, extra?: object) => Promise<unknown>;
  replyWithVideo: (video: object, extra?: object) => Promise<unknown>;
  answerCbQuery?: (text?: string) => Promise<unknown>;
}

@Update()
@Injectable()
export class BotUpdate {
  private static readonly TELEGRAM_VIDEO_LIMIT_BYTES = 50 * 1024 * 1024;
  private static readonly TELEGRAM_USERNAME_REGEX = /^@?([a-zA-Z0-9_]{5,32})$/;
  private static readonly TELEGRAM_USERNAME_LINK_REGEX =
    /^https?:\/\/t\.me\/([a-zA-Z0-9_]{5,32})\/?$/i;
  private static readonly STORIES_PER_PAGE = 5;
  private readonly logger = new Logger(BotUpdate.name);
  private activeLoginChatId: number | null = null;
  private botUsername: string | null = null;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userClientService: UserClientService,
    private readonly referralService: ReferralService,
  ) {}

  @Start()
  async onStart(ctx: TelegrafContext): Promise<void> {
    const name = ctx.from?.first_name ?? 'do‘st';
    const isReferralRegistered = this.registerReferralFromStartPayload(ctx);
    await this.replyHtml(
      ctx,
      this.formatStartMessage(name, isReferralRegistered),
    );
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
        'ℹ️ <b>Foydalanish</b>\n\n<code>/stories @username</code>\nYoki oddiy username yuboring:\n<code>durov</code>\n<code>@durov</code>\n<code>https://t.me/durov</code>',
      );
      return;
    }

    await this.handleStoriesRequest(ctx, username);
  }

  @Command('referral')
  async onReferral(ctx: TelegrafContext): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.replyHtml(ctx, '❌ <b>Foydalanuvchi aniqlanmadi</b>');
      return;
    }

    const botUsername = await this.getBotUsername(ctx);
    await this.replyHtml(
      ctx,
      this.formatReferralStatusMessage(userId, botUsername),
    );
  }

  @Action(/^page:([^:]+):(\d+)$/)
  async onPageCallback(ctx: TelegrafContext): Promise<void> {
    const username = ctx.match?.[1];
    const pageRaw = ctx.match?.[2];
    const page = Number.parseInt(pageRaw ?? '', 10);

    if (!username || Number.isNaN(page)) {
      await ctx.answerCbQuery?.('Sahifa ma’lumoti noto‘g‘ri.');
      return;
    }

    await ctx.answerCbQuery?.(`📄 ${page + 1}-sahifa yuklanmoqda...`);
    await this.handleStoriesRequest(ctx, username, page);
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

    const storyUsername = this.extractDirectUsername(rawText);
    if (storyUsername) {
      await this.handleStoriesRequest(ctx, storyUsername);
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

  private formatStartMessage(name: string, referred = false): string {
    const lines = [
      `👋 <b>Salom, ${this.escapeHtml(name)}!</b>`,
      '',
      'Men Telegram Bot + User Bot yordamchisiman.',
      '',
      '<b>Buyruqlar</b>',
      '/start — boshlang‘ich xabar',
      '/help — foydalanish bo‘yicha yordam',
      '/status — user-client holati',
      '/dialogs — so‘nggi chatlar',
      '/stories @username — storylarni yuklash (5 ta bepul)',
      '/referral — referal holatini ko‘rish',
      'username yuboring — barcha storylarni yuklash',
      '',
      'ℹ️ Birinchi 5 ta story bepul. Ko‘proq olish uchun 5 ta do‘st taklif qiling.',
    ];

    if (referred) {
      lines.splice(
        3,
        0,
        '🎉 Siz do‘stingizning taklif havolasi orqali qo‘shildingiz.',
        '',
      );
    }

    return lines.join('\n');
  }

  private formatHelpMessage(): string {
    return [
      '📘 <b>Yordam</b>',
      '',
      '<b>Story yuklash</b>',
      '<code>/stories @durov</code>',
      'Oddiy username yuboring:',
      '<code>durov</code>',
      '<code>@durov</code>',
      '<code>https://t.me/durov</code>',
      'Bot storylarni eng yangisidan boshlab 5 tadan yuboradi.',
      'Birinchi 5 ta story bepul.',
      '',
      '<b>Referal</b>',
      '<code>/referral</code>',
      'Ko‘proq story ochish uchun 5 ta do‘st taklif qiling.',
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
        return 'Akkaunt ulandi. Endi <code>/dialogs</code>, <code>/stories</code>, <code>/referral</code> va <code>/status</code> ishlaydi.';
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

  private registerReferralFromStartPayload(ctx: TelegrafContext): boolean {
    const payload = this.extractStartPayload(ctx.message?.text);
    if (!payload?.startsWith('ref_')) {
      return false;
    }

    const referrerId = Number.parseInt(payload.replace('ref_', ''), 10);
    const newUserId = ctx.from?.id;

    if (!newUserId || Number.isNaN(referrerId)) {
      return false;
    }

    return this.referralService.registerReferral(referrerId, newUserId);
  }

  private extractStartPayload(text?: string): string | null {
    if (!text) {
      return null;
    }

    const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/s);
    return match?.[1]?.trim() || null;
  }

  private async handleStoriesRequest(
    ctx: TelegrafContext,
    username: string,
    page = 0,
  ): Promise<void> {
    if (!this.userClientService.isAuthorized()) {
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

    const userId = this.getUserId(ctx);
    if (!userId) {
      await this.replyHtml(ctx, '❌ <b>Foydalanuvchi aniqlanmadi</b>');
      return;
    }

    const normalizedUsername = this.normalizeDisplayUsername(username);

    if (page >= 1 && !this.referralService.hasAccess(userId)) {
      const botUsername = await this.getBotUsername(ctx);
      await this.replyHtml(
        ctx,
        this.formatReferralGateMessage(userId, botUsername),
      );
      return;
    }

    await this.replyHtml(
      ctx,
      `⏳ <b>@${this.escapeHtml(
        normalizedUsername,
      )} — ${page + 1}-sahifa yuklanmoqda...</b>`,
    );

    void this.processStoriesRequest(chatId, normalizedUsername, page);
  }

  private extractStoriesUsername(text?: string): string | null {
    if (!text) {
      return null;
    }

    const match = text.match(/^\/stories(?:@\w+)?(?:\s+(.+))?$/s);
    return this.extractDirectUsername(match?.[1] ?? '');
  }

  private extractDirectUsername(text: string): string | null {
    const trimmedText = text.trim();

    const linkMatch = trimmedText.match(BotUpdate.TELEGRAM_USERNAME_LINK_REGEX);
    if (linkMatch) {
      return this.isNumericOnlyUsername(linkMatch[1]) ? null : linkMatch[1];
    }

    const usernameMatch = trimmedText.match(BotUpdate.TELEGRAM_USERNAME_REGEX);
    if (!usernameMatch) {
      return null;
    }

    return this.isNumericOnlyUsername(usernameMatch[1])
      ? null
      : usernameMatch[1];
  }

  private isNumericOnlyUsername(username: string): boolean {
    return /^\d+$/.test(username);
  }

  private normalizeDisplayUsername(username: string): string {
    return username
      .trim()
      .replace(/^https?:\/\/t\.me\//i, '')
      .replace(/^@+/, '');
  }

  private async processStoriesRequest(
    chatId: number,
    normalizedUsername: string,
    page: number,
  ): Promise<void> {
    try {
      const result = await this.userClientService.getUserStoriesPaginated(
        normalizedUsername,
        page,
      );

      if (result.stories.length === 0) {
        await this.sendHtmlToChat(chatId, '⚠️ Bu foydalanuvchida story yo‘q');
        return;
      }

      let uploadedStoriesCount = 0;
      let failedStoriesCount = 0;

      for (const [index, story] of result.stories.entries()) {
        try {
          await this.sendStoryMediaToChat(
            chatId,
            story,
            this.formatStoryCaption(story, page, result.pagesCount),
          );
          uploadedStoriesCount += 1;
        } catch (error) {
          failedStoriesCount += 1;
          this.logger.warn(
            `Story #${story.storyId} could not be sent for @${normalizedUsername}: ${this.getErrorMessage(error)}`,
          );
        }

        if (index < result.stories.length - 1) {
          await this.sleep(400);
        }
      }

      if (uploadedStoriesCount === 0) {
        await this.sendHtmlToChat(
          chatId,
          `❌ <b>Xatolik</b>\n\n${this.escapeHtml(`@${normalizedUsername} storylarini yuborib bo‘lmadi.`)}`,
        );
        return;
      }

      const startIndex = page * BotUpdate.STORIES_PER_PAGE + 1;
      const endIndex = startIndex + result.stories.length - 1;
      const paginationKeyboard = this.buildPaginationKeyboard(
        normalizedUsername,
        page,
        result,
      );

      const summaryLines = [
        `✅ <b>${startIndex}–${endIndex}</b> ta story yuklandi`,
        `📦 Jami: <b>${result.total}</b> ta story`,
      ];

      if (failedStoriesCount > 0) {
        summaryLines.push(`⚠️ Yuborilmadi: <b>${failedStoriesCount}</b> ta`);
      }

      await this.sendHtmlToChat(
        chatId,
        summaryLines.join('\n'),
        paginationKeyboard ? { reply_markup: paginationKeyboard } : {},
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

  private async sendHtmlToChat(
    chatId: number,
    text: string,
    extra: object = {},
  ): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...extra,
    });
  }

  private async sendStoryMediaToChat(
    chatId: number,
    story: StoryDownloadResult,
    caption: string,
  ): Promise<void> {
    const inputFile = Input.fromBuffer(story.buffer, story.filename);

    if (story.mimeType.startsWith('image/')) {
      await this.bot.telegram.sendPhoto(chatId, inputFile, { caption });
      return;
    }

    if (story.mimeType.startsWith('video/')) {
      if (story.buffer.length > BotUpdate.TELEGRAM_VIDEO_LIMIT_BYTES) {
        await this.bot.telegram.sendDocument(chatId, inputFile, { caption });
        return;
      }

      await this.bot.telegram.sendVideo(chatId, inputFile, { caption });
      return;
    }

    await this.bot.telegram.sendDocument(chatId, inputFile, { caption });
  }

  private formatStoryCaption(
    story: StoryDownloadResult,
    page: number,
    pagesCount: number,
  ): string {
    return `📅 ${this.formatStoryDate(story.date)} | Story #${story.storyId} | Sahifa ${page + 1}/${pagesCount || 1}`;
  }

  private formatStoryDate(unixTimestamp: number): string {
    return new Date(unixTimestamp * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace('.000Z', ' UTC');
  }

  private buildPaginationKeyboard(
    username: string,
    currentPage: number,
    result: PaginatedStoriesResult,
  ):
    | { inline_keyboard: { text: string; callback_data: string }[][] }
    | undefined {
    const buttons: { text: string; callback_data: string }[] = [];

    if (currentPage > 0) {
      buttons.push({
        text: '⬅️ Oldingi',
        callback_data: `page:${username}:${currentPage - 1}`,
      });
    }

    if (result.hasMore) {
      const nextStart = currentPage * BotUpdate.STORIES_PER_PAGE + 6;
      const nextEnd = Math.min(
        (currentPage + 1) * BotUpdate.STORIES_PER_PAGE + 5,
        result.total,
      );

      buttons.push({
        text: `Keyingi ➡️ (${nextStart}–${nextEnd})`,
        callback_data: `page:${username}:${currentPage + 1}`,
      });
    }

    if (buttons.length === 0) {
      return undefined;
    }

    return { inline_keyboard: [buttons] };
  }

  private formatReferralStatusMessage(
    userId: number,
    botUsername: string,
  ): string {
    const referralCount = this.referralService.getReferralCount(userId);
    const remainingReferrals =
      this.referralService.getRemainingReferrals(userId);
    const referralLink = this.referralService.generateReferralLink(
      userId,
      botUsername,
    );

    return [
      '👥 <b>Referal holati</b>',
      '',
      `✅ Taklif qilganlar: <b>${referralCount}/${ReferralService.REQUIRED_REFERRALS}</b>`,
      remainingReferrals > 0
        ? `⚠️ Ko‘proq story uchun yana <b>${remainingReferrals} ta</b> do‘st kerak`
        : '🎉 Siz barcha sahifalarni ochishingiz mumkin!',
      '',
      '🔗 Sizning havolangiz:',
      `<code>${this.escapeHtml(referralLink)}</code>`,
    ].join('\n');
  }

  private formatReferralGateMessage(
    userId: number,
    botUsername: string,
  ): string {
    const referralCount = this.referralService.getReferralCount(userId);
    const remainingReferrals =
      this.referralService.getRemainingReferrals(userId);
    const referralLink = this.referralService.generateReferralLink(
      userId,
      botUsername,
    );

    return [
      `🔒 Ko‘proq story yuklab olish uchun <b>${remainingReferrals} ta</b> do‘st taklif qiling!`,
      '',
      `👥 Sizning referallaringiz: <b>${referralCount}/${ReferralService.REQUIRED_REFERRALS}</b>`,
      '',
      '🔗 Taklif havolangiz:',
      `<code>${this.escapeHtml(referralLink)}</code>`,
      '',
      'Do‘stlaringiz shu havola orqali botga kirsa, hisoblanadi ✅',
    ].join('\n');
  }

  private async getBotUsername(ctx: TelegrafContext): Promise<string> {
    if (ctx.botInfo?.username) {
      this.botUsername = ctx.botInfo.username;
      return ctx.botInfo.username;
    }

    if (this.botUsername) {
      return this.botUsername;
    }

    const botInfo = await this.bot.telegram.getMe();
    this.botUsername = botInfo.username ?? '';
    return this.botUsername;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    return (
      ctx.chat?.id ??
      ctx.callbackQuery?.message?.chat?.id ??
      ctx.from?.id ??
      null
    );
  }

  private getUserId(ctx: TelegrafContext): number | null {
    return ctx.from?.id ?? null;
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
