import { Module } from '@nestjs/common';
import { AdminNotificationService } from './admin-notification.service';
import { AdminStatsService } from './admin-stats.service';

@Module({
  providers: [AdminNotificationService, AdminStatsService],
  exports: [AdminNotificationService],
})
export class AdminModule {}
