import { Module } from '@nestjs/common';
import { UserClientController } from './user-client.controller';
import { UserClientService } from './user-client.service';

@Module({
  providers: [UserClientService],
  controllers: [UserClientController],
  exports: [UserClientService],
})
export class UserClientModule {}
