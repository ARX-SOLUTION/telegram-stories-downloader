import { Module } from '@nestjs/common';
import { ReferralService } from '../referral/referral.service';
import { UserClientModule } from '../user-client/user-client.module';
import { BotUpdate } from './bot.update';

@Module({
  imports: [UserClientModule],
  providers: [BotUpdate, ReferralService],
})
export class BotModule {}
