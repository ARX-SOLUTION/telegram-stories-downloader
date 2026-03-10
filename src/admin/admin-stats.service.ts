import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRepository } from '../database/user.repository';
import { AdminNotificationService } from './admin-notification.service';

@Injectable()
export class AdminStatsService {
  private readonly logger = new Logger(AdminStatsService.name);

  constructor(
    private readonly adminNotificationService: AdminNotificationService,
    private readonly userRepository: UserRepository,
  ) {}

  @Cron('0 23 * * *', { timeZone: 'Asia/Tashkent' })
  async sendDailyStats(): Promise<void> {
    try {
      const stats = await this.userRepository.getDailyStats();
      await this.adminNotificationService.notifyDailyStats(stats);
    } catch (error) {
      this.logger.error(
        'Failed to prepare daily admin stats',
        error instanceof Error ? error.stack : undefined,
      );

      await this.adminNotificationService.notifyError(
        error instanceof Error
          ? error
          : new Error('Failed to prepare daily stats'),
        'admin:daily-stats',
      );
    }
  }
}
