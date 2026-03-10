import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger as NestLogger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Api, TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Logger as GramJsLogger } from 'telegram/extensions';
import { LogLevel } from 'telegram/extensions/Logger';
import { StringSession } from 'telegram/sessions';
import { USER_CLIENT_API_ROUTES } from './user-client.constants';
import {
  LoginFlowResponse,
  LoginState,
  StoryDownloadResult,
  StoryFetchStatus,
  StoryMediaItem,
  UserClientStatus,
} from './user-client.types';

interface LoginStateWaiter {
  states: Set<LoginState>;
  resolve: (state: LoginState | null) => void;
  timer: NodeJS.Timeout;
}

class AppGramJsLogger extends GramJsLogger {
  override canSend(level: LogLevel): boolean {
    if (level === LogLevel.ERROR) {
      return false;
    }

    return super.canSend(level);
  }
}

@Injectable()
export class UserClientService implements OnModuleInit {
  private readonly logger = new NestLogger(UserClientService.name);

  private client!: TelegramClient;
  private loginState: LoginState = 'idle';
  private sessionFilePath: string;
  private readonly configuredSessionString: string;
  private readonly gramJsLogger: GramJsLogger;
  private lastLoginError: string | null = null;
  private eventHandlersRegistered = false;
  private lastTransientGramJsWarningAt = 0;
  private readonly loginStateWaiters = new Set<LoginStateWaiter>();

  private phoneResolver: ((value: string) => void) | null = null;
  private codeResolver: ((value: string) => void) | null = null;
  private passwordResolver: ((value: string) => void) | null = null;

  constructor(private readonly config: ConfigService) {
    this.configuredSessionString =
      this.config.get<string>('telegram.sessionString')?.trim() ?? '';
    this.gramJsLogger = new AppGramJsLogger(
      this.resolveGramJsLogLevel(
        this.config.get<string>('telegram.logLevel') ?? 'warn',
      ),
    );
    this.sessionFilePath = path.join(
      process.cwd(),
      this.config.get<string>('telegram.sessionFile') ?? 'session.txt',
    );
  }

  async onModuleInit() {
    const apiId = this.config.get<number>('telegram.apiId')!;
    const apiHash = this.config.get<string>('telegram.apiHash')!;
    const savedSession = this.loadSession();

    this.client = new TelegramClient(
      new StringSession(savedSession),
      apiId,
      apiHash,
      {
        baseLogger: this.gramJsLogger,
        connectionRetries: 5,
      },
    );
    this.client.onError = (error) =>
      Promise.resolve(this.handleTopLevelGramJsError(error));

    await this.client.connect();

    if (await this.client.isUserAuthorized()) {
      this.setLoginState('authorized');
      this.lastLoginError = null;
      this.logger.log('✅ User client authorized from saved session');
      this.setupEventHandlers();
      return;
    }

    this.logger.warn(
      `⚠️ User client not authorized. Configure TELEGRAM_SESSION_STRING or keep a valid ${this.sessionFilePath} session file. Manual login is only a fallback via ${USER_CLIENT_API_ROUTES.initiateLogin}.`,
    );
  }

  private loadSession(): string {
    if (this.configuredSessionString) {
      return this.configuredSessionString;
    }

    try {
      if (fs.existsSync(this.sessionFilePath)) {
        return fs.readFileSync(this.sessionFilePath, 'utf-8').trim();
      }
    } catch {
      this.logger.warn('Could not load session file');
    }

    return '';
  }

  private persistSession() {
    const session = this.client.session.save() as unknown as string;
    fs.writeFileSync(this.sessionFilePath, session, 'utf-8');
    this.logger.log(`💾 Session saved to ${this.sessionFilePath}`);
  }

  private resolveGramJsLogLevel(level: string): LogLevel {
    const normalizedLevel = level.toLowerCase();

    switch (normalizedLevel) {
      case 'none':
        return LogLevel.NONE;
      case 'error':
        return LogLevel.ERROR;
      case 'info':
        return LogLevel.INFO;
      case 'debug':
        return LogLevel.DEBUG;
      case 'warn':
      default:
        return LogLevel.WARN;
    }
  }

  private handleTopLevelGramJsError(error: Error): void {
    const message = this.getTelegramErrorMessage(error);

    if (
      message === 'TIMEOUT' ||
      message.includes('TIMEOUT') ||
      message.includes('Cannot send requests while disconnected')
    ) {
      this.logTransientGramJsWarning(
        'GramJS ulanishi qisqa uzildi. Client qayta ulanmoqda.',
      );
      return;
    }

    this.logger.error(`GramJS client error: ${message}`);
  }

  private logTransientGramJsWarning(
    message: string,
    cooldownMs = 5 * 60 * 1000,
  ): void {
    const now = Date.now();
    if (now - this.lastTransientGramJsWarningAt < cooldownMs) {
      return;
    }

    this.lastTransientGramJsWarningAt = now;
    this.logger.warn(message);
  }

  initiateLogin(): LoginFlowResponse {
    if (this.loginState === 'authorized') {
      return this.createLoginFlowResponse(
        'authorized',
        'User client is already authorized.',
      );
    }

    if (this.isWaitingForLoginInput()) {
      return this.createLoginFlowResponse(
        this.loginState,
        `Login already in progress. Current step: ${this.loginState}.`,
      );
    }

    this.lastLoginError = null;
    this.clearLoginResolvers();
    this.setLoginState('waiting_phone');

    void this.client
      .start({
        phoneNumber: () =>
          new Promise<string>((resolve) => {
            this.phoneResolver = resolve;
          }),
        phoneCode: () => {
          this.setLoginState('waiting_code');
          this.logger.log(
            `📱 Code requested — submit via ${USER_CLIENT_API_ROUTES.submitCode} or bot chat`,
          );

          return new Promise<string>((resolve) => {
            this.codeResolver = resolve;
          });
        },
        password: () => {
          this.setLoginState('waiting_password');
          this.logger.log(
            `🔐 2FA password requested — submit via ${USER_CLIENT_API_ROUTES.submitPassword} or bot chat`,
          );

          return new Promise<string>((resolve) => {
            this.passwordResolver = resolve;
          });
        },
        onError: (error) => Promise.resolve(this.handleLoginFailure(error)),
      })
      .then(() => {
        this.handleLoginSuccess();
      })
      .catch((error: Error) => {
        if (error.message === 'AUTH_USER_CANCEL') {
          return;
        }

        this.handleLoginFailure(error);
      });

    return this.createLoginFlowResponse(
      'waiting_phone',
      'Login started. Share the phone number to continue.',
    );
  }

  async submitPhone(phoneNumber: string): Promise<LoginFlowResponse> {
    if (this.loginState !== 'waiting_phone' || !this.phoneResolver) {
      throw new BadRequestException(
        `Cannot submit phone in state "${this.loginState}". Start again via /login or ${USER_CLIENT_API_ROUTES.initiateLogin}.`,
      );
    }

    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);

    this.phoneResolver(normalizedPhoneNumber);
    this.phoneResolver = null;
    this.setLoginState('waiting_code');

    const nextState = await this.waitForAnyLoginState([
      'waiting_code',
      'waiting_password',
      'authorized',
      'error',
    ]);

    return this.createLoginFlowResponse(
      nextState ?? this.loginState,
      this.getPhoneSubmissionMessage(nextState ?? this.loginState),
    );
  }

  async submitCode(code: string): Promise<LoginFlowResponse> {
    if (this.loginState !== 'waiting_code' || !this.codeResolver) {
      throw new BadRequestException(
        `Cannot submit code in state "${this.loginState}". Submit the phone number first.`,
      );
    }

    const normalizedCode = this.normalizeCode(code);

    this.codeResolver(normalizedCode);
    this.codeResolver = null;

    const nextState = await this.waitForAnyLoginState([
      'waiting_password',
      'authorized',
      'error',
    ]);

    return this.createLoginFlowResponse(
      nextState ?? this.loginState,
      this.getCodeSubmissionMessage(nextState ?? this.loginState),
    );
  }

  async submitPassword(password: string): Promise<LoginFlowResponse> {
    if (this.loginState !== 'waiting_password' || !this.passwordResolver) {
      throw new BadRequestException(
        `Cannot submit password in state "${this.loginState}". 2FA may not be required.`,
      );
    }

    const normalizedPassword = password.trim();
    if (!normalizedPassword) {
      throw new BadRequestException('Password cannot be empty.');
    }

    this.passwordResolver(normalizedPassword);
    this.passwordResolver = null;

    const nextState = await this.waitForAnyLoginState(['authorized', 'error']);

    return this.createLoginFlowResponse(
      nextState ?? this.loginState,
      this.getPasswordSubmissionMessage(nextState ?? this.loginState),
    );
  }

  getStatus(): UserClientStatus {
    return {
      loginState: this.loginState,
      connected: !!this.client?.connected,
      authorized: this.loginState === 'authorized',
      nextAction: this.getNextAction(this.loginState),
      lastError: this.lastLoginError,
    };
  }

  getLoginState(): LoginState {
    return this.loginState;
  }

  isWaitingForLoginInput(): boolean {
    return (
      this.loginState === 'waiting_phone' ||
      this.loginState === 'waiting_code' ||
      this.loginState === 'waiting_password'
    );
  }

  async sendMessage(to: string, text: string): Promise<void> {
    this.ensureAuthorized();
    await this.client.sendMessage(to, { message: text });
    this.logger.log(`📤 Message sent to ${to}`);
  }

  async joinChannel(channel: string): Promise<void> {
    this.ensureAuthorized();
    await this.client.invoke(new Api.channels.JoinChannel({ channel }));
    this.logger.log(`📥 Joined channel: ${channel}`);
  }

  async leaveChannel(channel: string): Promise<void> {
    this.ensureAuthorized();
    await this.client.invoke(new Api.channels.LeaveChannel({ channel }));
    this.logger.log(`🚪 Left channel: ${channel}`);
  }

  async getDialogs(): Promise<
    { id: string; name: string; username: string }[]
  > {
    this.ensureAuthorized();
    const dialogs = await this.client.getDialogs({ limit: 50 });

    return dialogs.map((dialog) => ({
      id: dialog.id?.toString() ?? '',
      name: dialog.title ?? dialog.name ?? '',
      username:
        (dialog.entity as { username?: string } | undefined)?.username ?? '',
    }));
  }

  async getAllUserStories(username: string): Promise<StoryMediaItem[]> {
    this.ensureAuthorized();

    const normalizedUsername = this.normalizeUsername(username);
    const peer = await this.resolveStoryPeer(normalizedUsername);
    const storySources = [
      {
        label: 'active',
        optional: false,
        loader: () => this.getActiveStories(peer),
      },
      {
        label: 'pinned',
        optional: true,
        loader: () => this.getPinnedStories(peer),
      },
    ];

    if (this.canFetchStoriesArchive(peer)) {
      storySources.push({
        label: 'archive',
        optional: true,
        loader: () => this.getArchivedStories(peer),
      });
    }

    const sources = await Promise.allSettled(
      storySources.map((source) => source.loader()),
    );

    const storyItems = this.mergeStoryItems(
      sources.flatMap((source) =>
        source.status === 'fulfilled' ? source.value : [],
      ),
    );

    for (const [index, source] of sources.entries()) {
      if (source.status === 'rejected') {
        this.logger.warn(
          `Story source ${storySources[index].label} failed for @${normalizedUsername}: ${this.getTelegramErrorMessage(
            source.reason,
          )}`,
        );
      }
    }

    if (storyItems.length === 0) {
      const firstRejectedSource = sources.find(
        (source, index): source is PromiseRejectedResult =>
          source.status === 'rejected' && !storySources[index].optional,
      );

      if (firstRejectedSource) {
        throw this.mapStoryError(
          firstRejectedSource.reason,
          normalizedUsername,
        );
      }

      return [];
    }

    return this.toStoryMediaItems(this.mergeStoryItems(storyItems));
  }

  async getUserStories(username: string): Promise<StoryDownloadResult[]> {
    const stories = await this.getAllUserStories(username);
    const downloads: StoryDownloadResult[] = [];

    for (const [index, story] of stories.entries()) {
      downloads.push(await this.downloadStoryMedia(story.storyItem));

      if (index < stories.length - 1) {
        await this.sleep(300);
      }
    }

    return downloads;
  }

  async downloadStoryMedia(
    storyItem: Api.StoryItem,
  ): Promise<StoryDownloadResult> {
    const { media } = storyItem;

    if (!this.isDownloadableStoryMedia(media)) {
      throw new BadRequestException(`Story #${storyItem.id} media topilmadi.`);
    }

    const downloadedMedia = await this.client.downloadMedia(media, {});
    if (!downloadedMedia) {
      throw new BadRequestException(
        `Story #${storyItem.id} media yuklab bo‘lmadi.`,
      );
    }

    const buffer = await this.ensureStoryBuffer(downloadedMedia);

    if (media instanceof Api.MessageMediaPhoto) {
      return {
        storyId: storyItem.id,
        date: storyItem.date,
        buffer,
        mimeType: 'image/jpeg',
        filename: `story-${storyItem.id}.jpg`,
      };
    }

    const document = media.document;
    const mimeType =
      document instanceof Api.Document && document.mimeType
        ? document.mimeType
        : 'application/octet-stream';

    return {
      storyId: storyItem.id,
      date: storyItem.date,
      buffer,
      mimeType,
      filename: this.getStoryFilename(document, storyItem.id),
    };
  }

  createStoryFetchStatus(
    username: string,
    total: number,
    downloaded: number,
    failed: number,
  ): StoryFetchStatus {
    return {
      username: this.normalizeUsername(username),
      total,
      downloaded,
      failed,
    };
  }

  private setupEventHandlers() {
    if (this.eventHandlersRegistered) {
      return;
    }

    this.client.addEventHandler((event: NewMessageEvent) => {
      void this.logIncomingMessage(event);
    }, new NewMessage({}));

    this.eventHandlersRegistered = true;
    this.logger.log('🔔 Event handlers registered');
  }

  private async logIncomingMessage(event: NewMessageEvent): Promise<void> {
    try {
      const message = event.message;
      if (!message) {
        return;
      }

      const chat = await message.getChat();
      const username =
        (chat as { username?: string } | undefined)?.username ?? 'private';
      const sender = message.senderId?.toString() ?? 'unknown';

      this.logger.log(
        `📩 [@${username}] sender=${sender} | ${message.message}`,
      );
    } catch (error) {
      this.logger.error('Event handler error:', error);
    }
  }

  private handleLoginSuccess() {
    this.lastLoginError = null;
    this.clearLoginResolvers();
    this.setLoginState('authorized');
    this.persistSession();
    this.setupEventHandlers();
    this.logger.log('🎉 Login successful');
  }

  private handleLoginFailure(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : 'Unknown login error';
    this.lastLoginError = message;
    this.clearLoginResolvers();
    this.setLoginState('error');
    this.logger.error(`Login failed: ${message}`);
    return true;
  }

  private createLoginFlowResponse(
    state: LoginState,
    message: string,
  ): LoginFlowResponse {
    return {
      state,
      message,
      nextAction: this.getNextAction(state),
      lastError: this.lastLoginError,
    };
  }

  private getNextAction(state: LoginState): string | undefined {
    switch (state) {
      case 'idle':
        return `Bot owner TELEGRAM_SESSION_STRING yoki SESSION_FILE sozlashi kerak. Manual login faqat fallback: /login yoki POST ${USER_CLIENT_API_ROUTES.initiateLogin}.`;
      case 'waiting_phone':
        return `Submit phone via bot chat or POST ${USER_CLIENT_API_ROUTES.submitPhone}.`;
      case 'waiting_code':
        return `Submit Telegram code via bot chat or POST ${USER_CLIENT_API_ROUTES.submitCode}.`;
      case 'waiting_password':
        return `Submit 2FA password via bot chat or POST ${USER_CLIENT_API_ROUTES.submitPassword}.`;
      case 'authorized':
        return `Open dialogs with /dialogs, download stories with /stories <username>, or GET ${USER_CLIENT_API_ROUTES.dialogs}.`;
      case 'error':
        return `User session yaroqsiz. Bot owner sessionni yangilashi kerak. Fallback: /login yoki POST ${USER_CLIENT_API_ROUTES.initiateLogin}.`;
      default:
        return undefined;
    }
  }

  private getPhoneSubmissionMessage(state: LoginState): string {
    switch (state) {
      case 'waiting_code':
        return 'Phone number accepted. Telegram yuborgan kodni kiriting.';
      case 'waiting_password':
        return 'Phone number accepted. 2FA parol so‘raldi.';
      case 'authorized':
        return 'Phone number accepted. Login successful.';
      case 'error':
        return 'Telefon raqami tasdiqlanmadi.';
      default:
        return 'Phone number submitted. Holat tekshirilmoqda.';
    }
  }

  private getCodeSubmissionMessage(state: LoginState): string {
    switch (state) {
      case 'waiting_password':
        return 'Code accepted. Endi 2FA parolni yuboring.';
      case 'authorized':
        return 'Code accepted. Login successful.';
      case 'error':
        return 'Kod tasdiqlanmadi.';
      default:
        return 'Code submitted. Holat tekshirilmoqda.';
    }
  }

  private getPasswordSubmissionMessage(state: LoginState): string {
    switch (state) {
      case 'authorized':
        return 'Password accepted. Login successful.';
      case 'error':
        return 'Parol tasdiqlanmadi.';
      default:
        return 'Password submitted. Holat tekshirilmoqda.';
    }
  }

  private setLoginState(state: LoginState) {
    this.loginState = state;
    this.resolveStateWaiters(state);
  }

  private resolveStateWaiters(state: LoginState) {
    for (const waiter of [...this.loginStateWaiters]) {
      if (!waiter.states.has(state)) {
        continue;
      }

      clearTimeout(waiter.timer);
      this.loginStateWaiters.delete(waiter);
      waiter.resolve(state);
    }
  }

  private waitForAnyLoginState(
    states: LoginState[],
    timeoutMs = 8000,
  ): Promise<LoginState | null> {
    if (states.includes(this.loginState)) {
      return Promise.resolve(this.loginState);
    }

    return new Promise((resolve) => {
      const waiter: LoginStateWaiter = {
        states: new Set(states),
        resolve,
        timer: setTimeout(() => {
          this.loginStateWaiters.delete(waiter);
          resolve(null);
        }, timeoutMs),
      };

      this.loginStateWaiters.add(waiter);
    });
  }

  private clearLoginResolvers() {
    this.phoneResolver = null;
    this.codeResolver = null;
    this.passwordResolver = null;
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    const sanitizedPhoneNumber = phoneNumber.replace(/[^\d+]/g, '');

    if (!sanitizedPhoneNumber) {
      throw new BadRequestException(
        'Phone number is required. Use international format like +998901234567.',
      );
    }

    if (sanitizedPhoneNumber.startsWith('+')) {
      return sanitizedPhoneNumber;
    }

    if (/^\d{7,15}$/.test(sanitizedPhoneNumber)) {
      return `+${sanitizedPhoneNumber}`;
    }

    throw new BadRequestException(
      'Invalid phone number. Use international format like +998901234567.',
    );
  }

  private normalizeCode(code: string): string {
    const sanitizedCode = code.replace(/\D/g, '');

    if (!sanitizedCode) {
      throw new BadRequestException('Login code is required.');
    }

    return sanitizedCode;
  }

  private normalizeUsername(username: string): string {
    const normalizedUsername = username
      .trim()
      .replace(/^https?:\/\/t\.me\//i, '')
      .replace(/^@+/, '')
      .trim();

    if (!normalizedUsername) {
      throw new BadRequestException(
        'Username kiriting. Masalan: /stories durov',
      );
    }

    if (
      !/^[a-zA-Z0-9_]{5,32}$/.test(normalizedUsername) ||
      /^\d+$/.test(normalizedUsername)
    ) {
      throw new BadRequestException(
        'Username noto‘g‘ri. Masalan: /stories durov',
      );
    }

    return normalizedUsername;
  }

  private async resolveStoryPeer(
    normalizedUsername: string,
  ): Promise<Api.TypeInputPeer> {
    try {
      const entity = await this.client.getEntity(normalizedUsername);
      return await this.client.getInputEntity(entity);
    } catch (error) {
      throw this.mapStoryError(error, normalizedUsername);
    }
  }

  private async getActiveStories(
    peer: Api.TypeInputPeer,
  ): Promise<Api.StoryItem[]> {
    const response = await this.client.invoke(
      new Api.stories.GetPeerStories({ peer }),
    );

    return this.resolveStoryItems(peer, response.stories.stories);
  }

  private async getPinnedStories(
    peer: Api.TypeInputPeer,
  ): Promise<Api.StoryItem[]> {
    return this.getPagedStories(peer, (offsetId, limit) =>
      this.client.invoke(
        new Api.stories.GetPinnedStories({
          peer,
          offsetId,
          limit,
        }),
      ),
    );
  }

  private async getArchivedStories(
    peer: Api.TypeInputPeer,
  ): Promise<Api.StoryItem[]> {
    return this.getPagedStories(peer, (offsetId, limit) =>
      this.client.invoke(
        new Api.stories.GetStoriesArchive({
          peer,
          offsetId,
          limit,
        }),
      ),
    );
  }

  private canFetchStoriesArchive(peer: Api.TypeInputPeer): boolean {
    return (
      peer instanceof Api.InputPeerSelf ||
      peer instanceof Api.InputPeerChannel ||
      peer instanceof Api.InputPeerChannelFromMessage
    );
  }

  private async getPagedStories(
    peer: Api.TypeInputPeer,
    pageLoader: (
      offsetId: number,
      limit: number,
    ) => Promise<Api.stories.Stories>,
    limit = 100,
  ): Promise<Api.StoryItem[]> {
    const stories: Api.StoryItem[] = [];
    const seenOffsets = new Set<number>();
    let offsetId = 0;

    while (true) {
      const response = await pageLoader(offsetId, limit);
      const pageStoryIds = this.extractStoryIds(response.stories);
      const pageStories = await this.resolveStoryItems(peer, response.stories);

      if (pageStoryIds.length === 0) {
        break;
      }

      stories.push(...pageStories);

      const nextOffsetId = pageStoryIds[pageStoryIds.length - 1];
      if (pageStoryIds.length < limit || seenOffsets.has(nextOffsetId)) {
        break;
      }

      seenOffsets.add(nextOffsetId);
      offsetId = nextOffsetId;
    }

    return stories;
  }

  private extractStoryItems(stories: Api.TypeStoryItem[]): Api.StoryItem[] {
    return stories.filter(
      (story): story is Api.StoryItem => story instanceof Api.StoryItem,
    );
  }

  private extractSkippedStoryIds(stories: Api.TypeStoryItem[]): number[] {
    return stories
      .filter(
        (story): story is Api.StoryItemSkipped =>
          story instanceof Api.StoryItemSkipped,
      )
      .map((story) => story.id);
  }

  private extractStoryIds(stories: Api.TypeStoryItem[]): number[] {
    return stories
      .filter(
        (
          story,
        ): story is
          | Api.StoryItem
          | Api.StoryItemSkipped
          | Api.StoryItemDeleted =>
          story instanceof Api.StoryItem ||
          story instanceof Api.StoryItemSkipped ||
          story instanceof Api.StoryItemDeleted,
      )
      .map((story) => story.id);
  }

  private async resolveStoryItems(
    peer: Api.TypeInputPeer,
    stories: Api.TypeStoryItem[],
  ): Promise<Api.StoryItem[]> {
    const items = this.extractStoryItems(stories);
    const skippedIds = this.extractSkippedStoryIds(stories);

    if (skippedIds.length === 0) {
      return items;
    }

    try {
      const skippedItems = await this.getStoriesByIds(peer, skippedIds);
      return this.mergeStoryItems([...items, ...skippedItems]);
    } catch (error) {
      this.logger.warn(
        `Skipped story items could not be expanded: ${this.getTelegramErrorMessage(
          error,
        )}`,
      );
      return items;
    }
  }

  private async getStoriesByIds(
    peer: Api.TypeInputPeer,
    storyIds: number[],
  ): Promise<Api.StoryItem[]> {
    const resolvedStories: Api.StoryItem[] = [];
    const batchSize = 100;

    for (let index = 0; index < storyIds.length; index += batchSize) {
      const batchIds = storyIds.slice(index, index + batchSize);
      const response = await this.client.invoke(
        new Api.stories.GetStoriesByID({
          peer,
          id: batchIds,
        }),
      );

      resolvedStories.push(...this.extractStoryItems(response.stories));
    }

    return resolvedStories;
  }

  private mergeStoryItems(stories: Api.StoryItem[]): Api.StoryItem[] {
    const storyMap = new Map<number, Api.StoryItem>();

    for (const story of stories) {
      if (!storyMap.has(story.id)) {
        storyMap.set(story.id, story);
      }
    }

    return [...storyMap.values()].sort((left, right) => right.date - left.date);
  }

  private toStoryMediaItems(stories: Api.StoryItem[]): StoryMediaItem[] {
    const now = Math.floor(Date.now() / 1000);

    return stories
      .filter((story) => this.isDownloadableStoryMedia(story.media))
      .map((story) => ({
        id: story.id,
        date: story.date,
        isPinned: Boolean(story.pinned),
        isExpired: story.expireDate <= now,
        media: story.media,
        storyItem: story,
      }))
      .sort((left, right) => left.date - right.date);
  }

  private isDownloadableStoryMedia(
    media: Api.TypeMessageMedia | undefined,
  ): media is Api.MessageMediaPhoto | Api.MessageMediaDocument {
    return (
      media instanceof Api.MessageMediaPhoto ||
      media instanceof Api.MessageMediaDocument
    );
  }

  private async ensureStoryBuffer(downloadedMedia: Buffer | string) {
    if (Buffer.isBuffer(downloadedMedia)) {
      return downloadedMedia;
    }

    const buffer = await fs.promises.readFile(downloadedMedia);
    await fs.promises.unlink(downloadedMedia).catch(() => undefined);
    return buffer;
  }

  private getStoryFilename(
    document: Api.TypeDocument | undefined,
    storyId: number,
  ): string {
    if (document instanceof Api.Document) {
      const fileNameAttribute = document.attributes.find(
        (attribute): attribute is Api.DocumentAttributeFilename =>
          attribute instanceof Api.DocumentAttributeFilename,
      );

      if (fileNameAttribute?.fileName) {
        return fileNameAttribute.fileName;
      }

      return `story-${storyId}${this.getFileExtensionFromMimeType(document.mimeType)}`;
    }

    return `story-${storyId}.bin`;
  }

  private getFileExtensionFromMimeType(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'video/mp4':
        return '.mp4';
      case 'video/webm':
        return '.webm';
      default:
        return '.bin';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapStoryError(error: unknown, normalizedUsername: string): Error {
    const message = this.getTelegramErrorMessage(error);

    if (
      message.includes('USERNAME_INVALID') ||
      message.includes('USERNAME_NOT_OCCUPIED') ||
      message.includes('Could not find the input entity') ||
      message.includes('No user has') ||
      message.includes('Cannot find any entity')
    ) {
      return new NotFoundException(
        `Foydalanuvchi topilmadi: @${normalizedUsername}`,
      );
    }

    if (
      message.includes('FLOOD_WAIT') ||
      message.includes('A wait of') ||
      message.includes('FLOOD_PREMIUM_WAIT')
    ) {
      const seconds = this.extractFloodWaitSeconds(message);
      const waitSuffix = seconds
        ? ` ${seconds} soniyadan keyin urinib ko‘ring.`
        : ' Birozdan keyin urinib ko‘ring.';
      return new HttpException(
        `Telegram vaqtincha cheklov qo‘ydi.${waitSuffix}`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      message.includes('PRIVATE') ||
      message.includes('FORBIDDEN') ||
      message.includes('CHANNEL_PRIVATE') ||
      message.includes('CHAT_ADMIN_REQUIRED')
    ) {
      return new ForbiddenException(
        `@${normalizedUsername} storylarini ko‘rishga ruxsat yo‘q.`,
      );
    }

    return new BadRequestException(
      `@${normalizedUsername} storylarini olib bo‘lmadi.`,
    );
  }

  private getTelegramErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private extractFloodWaitSeconds(message: string): string | null {
    const match = message.match(
      /(?:FLOOD(?:_PREMIUM)?_WAIT_?|\bwait of )(\d+)/i,
    );
    return match?.[1] ?? null;
  }

  private ensureAuthorized() {
    if (this.loginState !== 'authorized') {
      throw new BadRequestException(
        `User client is not authorized. Current state: "${this.loginState}".`,
      );
    }
  }
}
