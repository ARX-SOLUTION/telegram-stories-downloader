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
import { AdminNotificationService } from '../admin/admin-notification.service';
import { BotKeyboards } from './bot-keyboards';
import { BotMessages } from './bot-messages';
import {
  YoutubeDownloadException,
  YoutubeDownloadService,
} from './youtube-download.service';
import { UserRepository } from '../database/user.repository';
import {
  ReferralAccessStatus,
  ReferralService,
} from '../referral/referral.service';
import { UserClientService } from '../user-client/user-client.service';
import {
  LoginFlowResponse,
  LoginState,
  PaginatedStoriesResult,
  StoryDownloadResult,
} from '../user-client/user-client.types';

interface TelegrafContext {
  chat?: { id: number };
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    language_code?: string;
  };
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
    /^(?:https?:\/\/)?(?:www\.)?t\.me\/([a-zA-Z0-9_]{5,32})\/?$/i;
  private static readonly YOUTUBE_URL_REGEX =
    /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=[\w-]{6,}|shorts\/[\w-]{6,})|youtu\.be\/[\w-]{6,})(?:[\w\-./?%&=]*)?$/i;
  private static readonly STORIES_PER_PAGE = 5;
  private readonly logger = new Logger(BotUpdate.name);
  private activeLoginChatId: number | null = null;
  private botUsername: string | null = null;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly userClientService: UserClientService,
    private readonly referralService: ReferralService,
    private readonly userRepository: UserRepository,
    private readonly adminNotificationService: AdminNotificationService,
    private readonly youtubeDownloadService: YoutubeDownloadService,
  ) {}

  @Start()
  async onStart(ctx: TelegrafContext): Promise<void> {
    const fromUser = ctx.from;
    if (!fromUser) {
      await this.replyHtml(ctx, BotMessages.userNotDetected());
      return;
    }

    const existingUser = await this.userRepository.findById(fromUser.id);
    const user = await this.userRepository.upsertUser({
      id: fromUser.id,
      username: fromUser.username ?? null,
      firstName: fromUser.first_name ?? null,
      lastName: fromUser.last_name ?? null,
      languageCode: fromUser.language_code ?? null,
    });

    if (!existingUser) {
      await this.adminNotificationService.notifyNewUser(user);
    }

    const isReferralRegistered = await this.registerReferralFromStartPayload(
      ctx,
      user,
    );
    if (isReferralRegistered) {
      await this.replyHtml(ctx, BotMessages.referralNewUser());
    }

    const botUsername = await this.getBotUsername(ctx);
    await this.replyHtml(
      ctx,
      BotMessages.start(Boolean(existingUser), botUsername),
    );
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
      await this.adminNotificationService.notifyError(
        this.toError(error),
        'bot:dialogs',
        this.getUserId(ctx) ?? undefined,
      );
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
    const referralStatus = await this.referralService.getReferralStatus(userId);
    await this.replyHtml(
      ctx,
      this.buildReferralStatusMessage(referralStatus, referralLink),
      this.buildReferralStatusMarkup(referralStatus, referralLink),
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
    const referralStatus = await this.referralService.getReferralStatus(userId);

    if (referralStatus.hasFullAccess) {
      await this.editHtml(
        ctx,
        BotMessages.referralSuccess(referralStatus.referralCount),
        BotKeyboards.referralSuccess(),
      );
      return;
    }

    await this.editHtml(
      ctx,
      this.buildReferralGateMessage(referralStatus, referralLink),
      BotKeyboards.referralGate(referralLink, referralStatus.referralCount),
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

    const youtubeInput = this.extractYoutubeInput(rawText);
    if (youtubeInput) {
      await this.handleYoutubeRequest(ctx, youtubeInput);
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
      await this.adminNotificationService.notifyError(
        this.toError(error),
        `bot:login-input:${this.userClientService.getLoginState()}`,
        this.getUserId(ctx) ?? undefined,
      );
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

  private async registerReferralFromStartPayload(
    ctx: TelegrafContext,
    user: Awaited<ReturnType<UserRepository['upsertUser']>>,
  ): Promise<boolean> {
    const payload = this.extractStartPayload(ctx.message?.text);
    if (!payload?.startsWith('ref_')) {
      return false;
    }

    const referrerId = Number.parseInt(payload.replace('ref_', ''), 10);
    if (Number.isNaN(referrerId)) {
      return false;
    }

    const isRegistered = await this.referralService.registerReferral(
      referrerId,
      user.id,
    );

    if (!isRegistered) {
      return false;
    }

    const referrer = await this.userRepository.findById(referrerId);
    const referralCount =
      await this.referralService.getReferralCount(referrerId);

    if (referrer) {
      await this.adminNotificationService.notifyReferral(
        referrer,
        user,
        referralCount,
      );

      if (referralCount === ReferralService.REQUIRED_REFERRALS) {
        await this.adminNotificationService.notifyFullAccessUnlocked(referrer);
      }
    }

    return true;
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
    const user = await this.userRepository.findById(userId);

    const referralStatus = await this.referralService.getReferralStatus(userId);

    if (page >= 1 && !referralStatus.hasFullAccess) {
      const botUsername = await this.getBotUsername(ctx);
      const referralLink = this.buildReferralLink(userId, botUsername);

      if (user) {
        await this.adminNotificationService.notifyReferralGateHit(
          user,
          normalizedUsername,
          referralStatus.referralCount,
        );
      }

      await this.replyHtml(
        ctx,
        this.buildReferralGateMessage(referralStatus, referralLink),
        BotKeyboards.referralGate(referralLink, referralStatus.referralCount),
      );
      return;
    }

    await this.replyHtml(
      ctx,
      BotMessages.storyLoading(this.escapeHtml(normalizedUsername), page),
    );

    void this.processStoriesRequest(chatId, normalizedUsername, page, userId);
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
      .replace(/^t\.me\//i, '')
      .replace(/^@+/, '');
  }

  private extractYoutubeInput(text: string): string | null {
    const trimmedText = text.trim();

    if (!BotUpdate.YOUTUBE_URL_REGEX.test(trimmedText)) {
      return null;
    }

    return trimmedText;
  }

  private async handleYoutubeRequest(
    ctx: TelegrafContext,
    input: string,
  ): Promise<void> {
    const chatId = this.getChatId(ctx);
    if (!chatId) {
      await this.replyHtml(ctx, BotMessages.chatNotDetected());
      return;
    }

    await this.replyHtml(ctx, BotMessages.youtubeLoading());

    try {
      const result = await this.youtubeDownloadService.downloadFromInput(input);
      const inputFile = Input.fromBuffer(result.buffer, result.filename);

      if (result.mimeType.startsWith('video/')) {
        await this.bot.telegram.sendVideo(chatId, inputFile, {
          caption: BotMessages.youtubeDone(this.escapeHtml(result.title)),
          parse_mode: 'HTML',
        });
        return;
      }

      await this.bot.telegram.sendDocument(chatId, inputFile, {
        caption: BotMessages.youtubeDone(this.escapeHtml(result.title)),
        parse_mode: 'HTML',
      });
    } catch (error) {
      await this.adminNotificationService.notifyError(
        this.toError(error),
        'bot:youtube-download',
        this.getUserId(ctx) ?? undefined,
      );
      await this.replyHtml(ctx, this.resolveYoutubeErrorMessage(error));
    }
  }

  private resolveYoutubeErrorMessage(error: unknown): string {
    if (!(error instanceof YoutubeDownloadException)) {
      return BotMessages.youtubeDownloadFailed();
    }

    switch (error.code) {
      case 'invalid_link':
        return BotMessages.youtubeInvalidLink();
      case 'unsupported_content':
        return BotMessages.youtubeUnsupported();
      case 'file_too_large':
        return BotMessages.youtubeFileTooLarge();
      case 'tool_not_installed':
        return BotMessages.youtubeToolNotInstalled();
      case 'download_failed':
      default:
        return BotMessages.youtubeDownloadFailed();
    }
  }

  private async processStoriesRequest(
    chatId: number,
    normalizedUsername: string,
    page: number,
    actorUserId: number,
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

      await this.userRepository.logStoryDownloadSession({
        userId: actorUserId,
        targetUsername: normalizedUsername,
        page,
        storyCount: uploadedStoriesCount,
      });

      const actorUser = await this.userRepository.findById(actorUserId);
      if (actorUser) {
        await this.adminNotificationService.notifyStoryDownload(
          actorUser,
          normalizedUsername,
          page,
          uploadedStoriesCount,
        );
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
      await this.adminNotificationService.notifyError(
        this.toError(error),
        `bot:stories:@${normalizedUsername}:page:${page}`,
        actorUserId,
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
    referralStatus: ReferralAccessStatus,
    referralLink: string,
  ): string {
    if (referralStatus.hasFullAccess) {
      return BotMessages.referralSuccess(referralStatus.referralCount);
    }

    return BotMessages.referralStatus(
      referralStatus.referralCount,
      this.escapeHtml(referralLink),
    );
  }

  private buildReferralStatusMarkup(
    referralStatus: ReferralAccessStatus,
    referralLink: string,
  ): object {
    if (referralStatus.hasFullAccess) {
      return BotKeyboards.referralSuccess();
    }

    return BotKeyboards.referralStatus(
      referralLink,
      referralStatus.referralCount,
    );
  }

  private buildReferralGateMessage(
    referralStatus: ReferralAccessStatus,
    referralLink: string,
  ): string {
    return BotMessages.referralGate(
      referralStatus.referralCount,
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

  private toError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Noma’lum xatolik');
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
