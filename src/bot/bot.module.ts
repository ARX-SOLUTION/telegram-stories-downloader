import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ReferralService } from '../referral/referral.service';
import { UserClientModule } from '../user-client/user-client.module';
import { BotUpdate } from './bot.update';

@Module({
  imports: [UserClientModule, AdminModule],
  providers: [BotUpdate, ReferralService],
})
export class BotModule {}
