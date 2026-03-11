import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ReferralService } from '../referral/referral.service';
import { UserClientModule } from '../user-client/user-client.module';
import { BotUpdate } from './bot.update';
import { YoutubeDownloadService } from './youtube-download.service';

@Module({
  imports: [UserClientModule, AdminModule],
  providers: [BotUpdate, ReferralService, YoutubeDownloadService],
})
export class BotModule {}
