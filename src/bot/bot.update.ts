import { HttpException, Injectable, Logger } from '@nestjs/common';
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
import { BotKeyboards } from './bot-keyboards';
import { BotMessages } from './bot-messages';
import { ReferralService } from '../referral/referral.service';
import { UserClientService } from '../user-client/user-client.service';
import {
  LoginFlowResponse,
  LoginState,
  PaginatedStoriesResult,
  StoryDownloadResult,
} from '../user-client/user-client.types';

interface TelegrafContext {
  chat?: { id: number };
  from?: { id: number; username?: string; first_name?: string };
  message?: { text?: string; contact?: { phone_number: string } };
  callbackQuery?: { data?: string; message?: { chat?: { id: number } } };
  botInfo?: { username?: string };
  match?: RegExpExecArray;
  reply: (text: string, extra?: object) => Promise<unknown>;
  editMessageText?: (text: string, extra?: object) => Promise<unknown>;
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
  private readonly seenUsers = new Set<number>();

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userClientService: UserClientService,
    private readonly referralService: ReferralService,
  ) {}

  @Start()
  async onStart(ctx: TelegrafContext): Promise<void> {
    const userId = this.getUserId(ctx);
    const isReturning = userId !== null && this.seenUsers.has(userId);
    if (userId !== null) {
      this.seenUsers.add(userId);
    }

    const isReferralRegistered = this.registerReferralFromStartPayload(ctx);
    if (isReferralRegistered) {
      await this.replyHtml(ctx, BotMessages.referralNewUser());
    }

    const botUsername = await this.getBotUsername(ctx);
    await this.replyHtml(ctx, BotMessages.start(isReturning, botUsername));
  }

  @Help()
  async onHelp(ctx: TelegrafContext): Promise<void> {
    const botUsername = await this.getBotUsername(ctx);
    await this.replyHtml(ctx, BotMessages.help(botUsername));
  }

  @Command('status')
  async onStatus(ctx: TelegrafContext): Promise<void> {
    const status = this.userClientService.getStatus();
    await this.replyHtml(
      ctx,
      BotMessages.status(
        status.loginState,
        status.phoneNumber ? this.escapeHtml(status.phoneNumber) : null,
      ),
      this.getReplyMarkup(status.loginState),
    );
  }

  @Command('login')
  async onLogin(ctx: TelegrafContext): Promise<void> {
    const chatId = this.getChatId(ctx);

    if (this.isLoginLockedToAnotherChat(chatId)) {
      await this.replyHtml(ctx, BotMessages.loginLocked());
      return;
    }

    const result = this.userClientService.initiateLogin();
    this.captureLoginChat(chatId, result.state);

    await this.replyHtml(
      ctx,
      this.buildLoginFlowMessage(result),
      this.getReplyMarkup(result.state),
    );
  }

  @Command('cancel')
  async onCancel(ctx: TelegrafContext): Promise<void> {
    const result = this.userClientService.cancelLogin();
    this.captureLoginChat(this.getChatId(ctx), result.state);
    await this.replyHtml(
      ctx,
      result.message === 'Login cancelled.'
        ? BotMessages.loginCancelled()
        : BotMessages.loginInactive(),
      this.getReplyMarkup(result.state),
    );
  }

  @Command('dialogs')
  async onDialogs(ctx: TelegrafContext): Promise<void> {
    try {
      const dialogs = await this.userClientService.getDialogs();

      if (dialogs.length === 0) {
        await this.replyHtml(ctx, BotMessages.dialogsEmpty());
        return;
      }

      await this.replyHtml(ctx, this.buildDialogsMessage(dialogs));
    } catch (error) {
      await this.replyHtml(
        ctx,
        BotMessages.dialogsError(this.escapeHtml(this.getErrorMessage(error))),
      );
    }
  }

  @Command('stories')
  async onStories(ctx: TelegrafContext): Promise<void> {
    const username = this.extractStoriesUsername(ctx.message?.text);
    if (!username) {
      await this.replyHtml(ctx, BotMessages.usageStories());
      return;
    }

    await this.handleStoriesRequest(ctx, username);
  }

  @Command('referral')
  async onReferral(ctx: TelegrafContext): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.replyHtml(ctx, BotMessages.userNotDetected());
      return;
    }

    const botUsername = await this.getBotUsername(ctx);
    const referralLink = this.buildReferralLink(userId, botUsername);
    await this.replyHtml(
      ctx,
      this.buildReferralStatusMessage(userId, referralLink),
      this.buildReferralStatusMarkup(userId, referralLink),
    );
  }

  @Action(/^page:([^:]+):(\d+)$/)
  async onPageCallback(ctx: TelegrafContext): Promise<void> {
    const username = ctx.match?.[1];
    const pageRaw = ctx.match?.[2];
    const page = Number.parseInt(pageRaw ?? '', 10);

    if (!username || Number.isNaN(page)) {
      await ctx.answerCbQuery?.(BotMessages.pageInvalid());
      return;
    }

    await ctx.answerCbQuery?.(BotMessages.pageLoading(page));
    await this.handleStoriesRequest(ctx, username, page);
  }

  @Action('referral_status')
  async onReferralStatusAction(ctx: TelegrafContext): Promise<void> {
    const userId = this.getUserId(ctx);
    if (!userId) {
      await ctx.answerCbQuery?.(BotMessages.pageInvalid());
      return;
    }

    await ctx.answerCbQuery?.(BotMessages.referralStatusToast());

    const botUsername = await this.getBotUsername(ctx);
    const referralLink = this.buildReferralLink(userId, botUsername);

    if (this.referralService.hasAccess(userId)) {
      await this.editHtml(
        ctx,
        BotMessages.referralSuccess(
          this.referralService.getReferralCount(userId),
        ),
        BotKeyboards.referralSuccess(),
      );
      return;
    }

    await this.editHtml(
      ctx,
      this.buildReferralGateMessage(userId, referralLink),
      BotKeyboards.referralGate(
        referralLink,
        this.referralService.getReferralCount(userId),
      ),
    );
  }

  @Action('referral_copy')
  async onReferralCopyAction(ctx: TelegrafContext): Promise<void> {
    const userId = this.getUserId(ctx);
    if (!userId) {
      await ctx.answerCbQuery?.(BotMessages.pageInvalid());
      return;
    }

    const botUsername = await this.getBotUsername(ctx);
    const referralLink = this.buildReferralLink(userId, botUsername);

    await ctx.answerCbQuery?.(BotMessages.referralCopyToast());
    await this.replyHtml(
      ctx,
      BotMessages.referralCopy(this.escapeHtml(referralLink)),
      {
        ...BotKeyboards.referralCopy(referralLink),
        disable_web_page_preview: true,
      },
    );
  }

  @Action('referral_continue')
  async onReferralContinueAction(ctx: TelegrafContext): Promise<void> {
    await ctx.answerCbQuery?.(BotMessages.referralContinueToast());
    await this.editHtml(ctx, BotMessages.referralContinue());
  }

  @On('contact')
  async onContact(ctx: TelegrafContext): Promise<void> {
    const phoneNumber = ctx.message?.contact?.phone_number;
    if (!phoneNumber) {
      return;
    }

    if (!this.shouldHandleLoginInput(ctx)) {
      await this.replyHtml(ctx, BotMessages.contactIgnored());
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
          await this.replyHtml(ctx, BotMessages.loginInactive());
          return;
      }

      this.captureLoginChat(this.getChatId(ctx), result.state);

      await this.replyHtml(
        ctx,
        this.buildLoginFlowMessage(result),
        this.getReplyMarkup(result.state),
      );
    } catch (error) {
      await this.replyHtml(
        ctx,
        BotMessages.loginError(this.escapeHtml(this.getErrorMessage(error))),
        this.getReplyMarkup(this.userClientService.getLoginState()),
      );
    }
  }

  private buildLoginFlowMessage(result: LoginFlowResponse): string {
    const phoneNumber = this.userClientService.getStatus().phoneNumber;
    const escapedPhoneNumber = phoneNumber
      ? this.escapeHtml(phoneNumber)
      : undefined;

    if (result.message === 'Login cancelled.') {
      return BotMessages.loginCancelled();
    }

    if (
      result.state === 'authorized' &&
      result.message.toLowerCase().includes('already authorized')
    ) {
      return BotMessages.loginAlreadyAuthorized();
    }

    switch (result.state) {
      case 'waiting_phone':
        return BotMessages.loginStart();
      case 'waiting_code':
        return BotMessages.loginWaitingCode(escapedPhoneNumber);
      case 'waiting_password':
        return BotMessages.loginWaitingPassword();
      case 'authorized':
        return BotMessages.loginSuccess();
      case 'error':
        return BotMessages.loginError(
          this.escapeHtml(result.lastError ?? result.message),
        );
      case 'idle':
      default:
        return BotMessages.loginInactive();
    }
  }

  private buildDialogsMessage(
    dialogs: { id: string; name: string; username: string }[],
  ): string {
    const lines = dialogs.slice(0, 20).map((dialog, index) => {
      const name = this.escapeHtml(dialog.name || 'Nomsiz');
      const target = dialog.username
        ? `@${this.escapeHtml(dialog.username)}`
        : `<code>${this.escapeHtml(dialog.id)}</code>`;

      return `${index + 1}. ${name} — ${target}`;
    });

    return BotMessages.dialogs(lines);
  }

  private buildStoryErrorMessage(error: unknown, username: string): string {
    const escapedUsername = this.escapeHtml(username);

    if (error instanceof HttpException) {
      const status = error.getStatus();

      if (status === 404) {
        return BotMessages.storyUserNotFound(escapedUsername);
      }

      if (status === 403) {
        return BotMessages.storyPrivateAccount(escapedUsername);
      }

      if (status === 429) {
        return BotMessages.storyFloodWait(
          this.extractFloodWaitSeconds(error.message) ?? 60,
        );
      }

      if (status === 401) {
        return BotMessages.storyNotAuthorized();
      }
    }

    const message = this.getErrorMessage(error);
    if (
      message.includes('FLOOD_WAIT') ||
      message.includes('A wait of') ||
      message.includes('FLOOD_PREMIUM_WAIT')
    ) {
      return BotMessages.storyFloodWait(
        this.extractFloodWaitSeconds(message) ?? 60,
      );
    }

    return BotMessages.unknownError();
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

  private async editHtml(
    ctx: TelegrafContext,
    text: string,
    extra: object = {},
  ): Promise<void> {
    if (!ctx.editMessageText) {
      await this.replyHtml(ctx, text, extra);
      return;
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...extra,
      });
    } catch (error) {
      if (this.getErrorMessage(error).includes('message is not modified')) {
        return;
      }

      throw error;
    }
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
      await this.replyHtml(ctx, BotMessages.storyNotAuthorized());
      return;
    }

    const chatId = this.getChatId(ctx);
    if (!chatId) {
      await this.replyHtml(ctx, BotMessages.chatNotDetected());
      return;
    }

    const userId = this.getUserId(ctx);
    if (!userId) {
      await this.replyHtml(ctx, BotMessages.userNotDetected());
      return;
    }

    const normalizedUsername = this.normalizeDisplayUsername(username);

    if (page >= 1 && !this.referralService.hasAccess(userId)) {
      const botUsername = await this.getBotUsername(ctx);
      const referralLink = this.buildReferralLink(userId, botUsername);
      await this.replyHtml(
        ctx,
        this.buildReferralGateMessage(userId, referralLink),
        BotKeyboards.referralGate(
          referralLink,
          this.referralService.getReferralCount(userId),
        ),
      );
      return;
    }

    await this.replyHtml(
      ctx,
      BotMessages.storyLoading(this.escapeHtml(normalizedUsername), page),
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
        await this.sendHtmlToChat(
          chatId,
          BotMessages.storyEmpty(this.escapeHtml(normalizedUsername)),
        );
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
        await this.sendHtmlToChat(chatId, BotMessages.unknownError());
        return;
      }

      const startIndex = page * BotUpdate.STORIES_PER_PAGE + 1;
      const endIndex = startIndex + result.stories.length - 1;
      const paginationKeyboard = this.buildPaginationKeyboard(
        normalizedUsername,
        page,
        result,
      );

      await this.sendHtmlToChat(
        chatId,
        BotMessages.storyPageDone(
          this.escapeHtml(normalizedUsername),
          page,
          result.pagesCount,
          startIndex,
          endIndex,
          result.total,
          failedStoriesCount,
        ),
        paginationKeyboard ? { reply_markup: paginationKeyboard } : {},
      );
    } catch (error) {
      this.logger.error(
        `Story download failed for @${normalizedUsername}: ${this.getErrorMessage(error)}`,
      );
      await this.sendHtmlToChat(
        chatId,
        this.buildStoryErrorMessage(error, normalizedUsername),
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
      await this.bot.telegram.sendPhoto(chatId, inputFile, {
        caption,
        parse_mode: 'HTML',
      });
      return;
    }

    if (story.mimeType.startsWith('video/')) {
      if (story.buffer.length > BotUpdate.TELEGRAM_VIDEO_LIMIT_BYTES) {
        await this.bot.telegram.sendDocument(chatId, inputFile, {
          caption,
          parse_mode: 'HTML',
        });
        return;
      }

      await this.bot.telegram.sendVideo(chatId, inputFile, {
        caption,
        parse_mode: 'HTML',
      });
      return;
    }

    await this.bot.telegram.sendDocument(chatId, inputFile, {
      caption,
      parse_mode: 'HTML',
    });
  }

  private formatStoryCaption(
    story: StoryDownloadResult,
    page: number,
    pagesCount: number,
  ): string {
    return BotMessages.storyCaption(
      this.formatStoryDate(story.date),
      story.storyId,
      page,
      pagesCount,
    );
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

  private buildReferralStatusMessage(
    userId: number,
    referralLink: string,
  ): string {
    const referralCount = this.referralService.getReferralCount(userId);

    if (this.referralService.hasAccess(userId)) {
      return BotMessages.referralSuccess(referralCount);
    }

    return BotMessages.referralStatus(
      referralCount,
      this.escapeHtml(referralLink),
    );
  }

  private buildReferralStatusMarkup(
    userId: number,
    referralLink: string,
  ): object {
    const referralCount = this.referralService.getReferralCount(userId);

    if (this.referralService.hasAccess(userId)) {
      return BotKeyboards.referralSuccess();
    }

    return BotKeyboards.referralStatus(referralLink, referralCount);
  }

  private buildReferralGateMessage(
    userId: number,
    referralLink: string,
  ): string {
    const referralCount = this.referralService.getReferralCount(userId);

    return BotMessages.referralGate(
      referralCount,
      this.escapeHtml(referralLink),
    );
  }

  private buildReferralLink(userId: number, botUsername: string): string {
    return this.referralService.generateReferralLink(userId, botUsername);
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

  private extractFloodWaitSeconds(message: string): number | null {
    const match = message.match(
      /(?:FLOOD(?:_PREMIUM)?_WAIT_?|\bwait of )(\d+)/i,
    );
    const seconds = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;

    return Number.isNaN(seconds) ? null : seconds;
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
