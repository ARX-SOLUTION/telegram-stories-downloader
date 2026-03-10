import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { DRIZZLE } from './database.constants';
import { UserRepository } from './user.repository';
import * as schema from './schema';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('database.url')?.trim();

        if (!databaseUrl) {
          throw new Error('DATABASE_URL is required for Drizzle/NeonDB.');
        }

        return drizzle(neon(databaseUrl), { schema });
      },
    },
    UserRepository,
  ],
  exports: [DRIZZLE, UserRepository],
})
export class DatabaseModule {}
