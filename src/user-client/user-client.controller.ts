import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ChannelDto,
  SendMessageDto,
  SubmitCodeDto,
  SubmitPasswordDto,
  SubmitPhoneDto,
} from './user-client.dto';
import { USER_CLIENT_API_BASE_PATH } from './user-client.constants';
import { UserClientService } from './user-client.service';

@Controller('user-client')
export class UserClientController {
  constructor(private readonly userClientService: UserClientService) {}

  @Get()
  getOverview() {
    const status = this.userClientService.getStatus();

    return {
      name: 'user-client',
      basePath: USER_CLIENT_API_BASE_PATH,
      status,
      endpoints: {
        status: `${USER_CLIENT_API_BASE_PATH}/status`,
        dialogs: `${USER_CLIENT_API_BASE_PATH}/dialogs`,
        stories: 'Bot command: /stories <username>',
        sendMessage: `POST ${USER_CLIENT_API_BASE_PATH}/send-message`,
        joinChannel: `POST ${USER_CLIENT_API_BASE_PATH}/join-channel`,
        leaveChannel: `POST ${USER_CLIENT_API_BASE_PATH}/leave-channel`,
      },
    };
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /**
   * GET /user-client/status
   * Returns current login state, connection status and authorization.
   * Poll this after each login step.
   */
  @Get('status')
  getStatus() {
    return this.userClientService.getStatus();
  }

  // ─── Login flow ───────────────────────────────────────────────────────────

  /**
   * POST /user-client/login/initiate
   * Start the MTProto login flow. Call this once, then proceed with the steps below.
   */
  @Post('login/initiate')
  initiateLogin() {
    return this.userClientService.initiateLogin();
  }

  /**
   * POST /user-client/login/submit-phone
   * Body: { "phoneNumber": "+998901234567" }
   */
  @Post('login/submit-phone')
  submitPhone(@Body() dto: SubmitPhoneDto) {
    return this.userClientService.submitPhone(dto.phoneNumber);
  }

  /**
   * POST /user-client/login/submit-code
   * Body: { "code": "12345" }   ← code received in Telegram app / SMS
   */
  @Post('login/submit-code')
  submitCode(@Body() dto: SubmitCodeDto) {
    return this.userClientService.submitCode(dto.code);
  }

  /**
   * POST /user-client/login/submit-password
   * Body: { "password": "yourTwoFAPassword" }   ← only if state = "waiting_password"
   */
  @Post('login/submit-password')
  submitPassword(@Body() dto: SubmitPasswordDto) {
    return this.userClientService.submitPassword(dto.password);
  }

  // ─── User-bot actions ─────────────────────────────────────────────────────

  /**
   * POST /user-client/send-message
   * Body: { "to": "@username", "text": "Hello!" }
   */
  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto) {
    await this.userClientService.sendMessage(dto.to, dto.text);
    return { success: true };
  }

  /**
   * POST /user-client/join-channel
   * Body: { "channel": "obsidian_uz" }
   */
  @Post('join-channel')
  async joinChannel(@Body() dto: ChannelDto) {
    await this.userClientService.joinChannel(dto.channel);
    return { success: true, message: `Joined @${dto.channel}` };
  }

  /**
   * POST /user-client/leave-channel
   * Body: { "channel": "obsidian_uz" }
   */
  @Post('leave-channel')
  async leaveChannel(@Body() dto: ChannelDto) {
    await this.userClientService.leaveChannel(dto.channel);
    return { success: true, message: `Left @${dto.channel}` };
  }

  /**
   * GET /user-client/dialogs
   * Returns the 50 most recent chats/channels of the logged-in user.
   */
  @Get('dialogs')
  getDialogs() {
    return this.userClientService.getDialogs();
  }
}
