import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { UserClientModule } from './user-client/user-client.module';

@Module({
  imports: [
    // ── Global config (reads .env) ──────────────────────────────────────────
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Telegram Bot (Bot API via Telegraf) ─────────────────────────────────
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        token: config.get<string>('telegram.botToken')!,
        // Enable HTML parse mode globally
        include: [BotModule],
      }),
      inject: [ConfigService],
    }),

    // ── Database (Drizzle ORM + NeonDB) ─────────────────────────────────────
    DatabaseModule,

    // ── User bot (MTProto via gramjs) ───────────────────────────────────────
    UserClientModule,

    // ── Bot handlers ────────────────────────────────────────────────────────
    BotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
