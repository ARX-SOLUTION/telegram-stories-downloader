import { Module } from '@nestjs/common';
import { UserClientModule } from '../user-client/user-client.module';
import { BotUpdate } from './bot.update';

@Module({
  imports: [UserClientModule],
  providers: [BotUpdate],
})
export class BotModule {}
