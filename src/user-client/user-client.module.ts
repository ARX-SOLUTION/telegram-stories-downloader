import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { UserClientController } from './user-client.controller';
import { UserClientService } from './user-client.service';

@Module({
  imports: [AdminModule],
  providers: [UserClientService],
  controllers: [UserClientController],
  exports: [UserClientService],
})
export class UserClientModule {}
