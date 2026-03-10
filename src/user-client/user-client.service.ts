import
    {
        BadRequestException,
        Injectable,
        Logger,
        OnModuleInit,
    } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Api, TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { StringSession } from 'telegram/sessions';

type LoginState =
  | 'idle'
  | 'waiting_phone'
  | 'waiting_code'
  | 'waiting_password'
  | 'authorized'
  | 'error';

@Injectable()
export class UserClientService implements OnModuleInit {
  private readonly logger = new Logger(UserClientService.name);

  private client!: TelegramClient;
  private loginState: LoginState = 'idle';
  private sessionFilePath: string;

  // Promise resolvers for the interactive login flow
  private phoneResolver: ((v: string) => void) | null = null;
  private codeResolver: ((v: string) => void) | null = null;
  private passwordResolver: ((v: string) => void) | null = null;

  constructor(private readonly config: ConfigService) {
    this.sessionFilePath = path.join(
      process.cwd(),
      this.config.get<string>('telegram.sessionFile') ?? 'session.txt',
    );
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit() {
    const apiId = this.config.get<number>('telegram.apiId')!;
    const apiHash = this.config.get<string>('telegram.apiHash')!;
    const savedSession = this.loadSession();

    this.client = new TelegramClient(
      new StringSession(savedSession),
      apiId,
      apiHash,
      { connectionRetries: 5 },
    );

    await this.client.connect();

    if (await this.client.isUserAuthorized()) {
      this.loginState = 'authorized';
      this.logger.log('✅ User client authorized from saved session');
      this.setupEventHandlers();
    } else {
      this.logger.warn(
        '⚠️  User client not authorized. Use POST /user-client/login/initiate',
      );
    }
  }

  // ─── Session helpers ──────────────────────────────────────────────────────

  private loadSession(): string {
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

  // ─── Login flow ───────────────────────────────────────────────────────────

  /**
   * Step 1 — call once to begin the login flow.
   * Internally starts client.start() which drives the entire MTProto auth.
   */
  async initiateLogin(): Promise<{ state: LoginState; message: string }> {
    if (this.loginState === 'authorized') {
      return { state: 'authorized', message: 'Already authorized' };
    }
    if (
      this.loginState === 'waiting_phone' ||
      this.loginState === 'waiting_code' ||
      this.loginState === 'waiting_password'
    ) {
      return {
        state: this.loginState,
        message: `Login already in progress. Current step: ${this.loginState}`,
      };
    }

    this.loginState = 'waiting_phone';

    // Fire-and-forget — resolvers drive each step via HTTP calls below
    this.client
      .start({
        phoneNumber: () =>
          new Promise<string>((resolve) => {
            this.phoneResolver = resolve;
          }),

        phoneCode: () => {
          this.loginState = 'waiting_code';
          this.logger.log('📱 Code requested — call POST /login/submit-code');
          return new Promise<string>((resolve) => {
            this.codeResolver = resolve;
          });
        },

        password: () => {
          this.loginState = 'waiting_password';
          this.logger.log(
            '🔐 2FA password requested — call POST /login/submit-password',
          );
          return new Promise<string>((resolve) => {
            this.passwordResolver = resolve;
          });
        },

        onError: (err) => {
          this.logger.error('Login error:', err);
          this.loginState = 'error';
        },
      })
      .then(() => {
        this.loginState = 'authorized';
        this.persistSession();
        this.setupEventHandlers();
        this.logger.log('🎉 Login successful!');
      })
      .catch((err: Error) => {
        this.logger.error('Login failed:', err.message);
        this.loginState = 'error';
      });

    return {
      state: this.loginState,
      message: 'Login initiated. Submit phone via POST /user-client/login/submit-phone',
    };
  }

  /** Step 2 — submit phone number (e.g. +998901234567) */
  async submitPhone(phoneNumber: string): Promise<{ state: LoginState; message: string }> {
    if (this.loginState !== 'waiting_phone' || !this.phoneResolver) {
      throw new BadRequestException(
        `Cannot submit phone in state "${this.loginState}". Call /login/initiate first.`,
      );
    }
    this.phoneResolver(phoneNumber);
    this.phoneResolver = null;
    return {
      state: this.loginState,
      message: 'Phone submitted. Telegram will send a code. Poll GET /user-client/status to see when state becomes "waiting_code".',
    };
  }

  /** Step 3 — submit the OTP code received in Telegram */
  async submitCode(code: string): Promise<{ state: LoginState; message: string }> {
    if (this.loginState !== 'waiting_code' || !this.codeResolver) {
      throw new BadRequestException(
        `Cannot submit code in state "${this.loginState}". Submit phone first.`,
      );
    }
    this.codeResolver(code);
    this.codeResolver = null;
    return {
      state: this.loginState,
      message: 'Code submitted. Poll GET /user-client/status — state will become "authorized" or "waiting_password" if 2FA is enabled.',
    };
  }

  /** Step 4 (optional) — submit 2-step verification password */
  async submitPassword(password: string): Promise<{ state: LoginState; message: string }> {
    if (this.loginState !== 'waiting_password' || !this.passwordResolver) {
      throw new BadRequestException(
        `Cannot submit password in state "${this.loginState}". 2FA may not be required.`,
      );
    }
    this.passwordResolver(password);
    this.passwordResolver = null;
    return {
      state: this.loginState,
      message: 'Password submitted. Poll GET /user-client/status for "authorized".',
    };
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  async getStatus(): Promise<{
    loginState: LoginState;
    connected: boolean;
    authorized: boolean;
  }> {
    return {
      loginState: this.loginState,
      connected: !!this.client?.connected,
      authorized: this.loginState === 'authorized',
    };
  }

  // ─── User-bot actions ─────────────────────────────────────────────────────

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
    await this.client.invoke(
      new Api.channels.LeaveChannel({ channel }),
    );
    this.logger.log(`🚪 Left channel: ${channel}`);
  }

  async getDialogs(): Promise<{ id: string; name: string; username: string }[]> {
    this.ensureAuthorized();
    const dialogs = await this.client.getDialogs({ limit: 50 });
    return dialogs.map((d) => ({
      id: d.id?.toString() ?? '',
      name: d.title ?? d.name ?? '',
      username: (d.entity as any)?.username ?? '',
    }));
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private setupEventHandlers() {
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        if (!message) return;

        const chat = await message.getChat();
        const username = (chat as any)?.username ?? 'private';
        const sender = message.senderId?.toString() ?? 'unknown';

        this.logger.log(
          `📩 [@${username}] sender=${sender} | ${message.message}`,
        );
      } catch (err) {
        this.logger.error('Event handler error:', err);
      }
    }, new NewMessage({}));

    this.logger.log('🔔 Event handlers registered');
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private ensureAuthorized() {
    if (this.loginState !== 'authorized') {
      throw new BadRequestException(
        `User client is not authorized. Current state: "${this.loginState}".`,
      );
    }
  }
}
