import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { User } from '../database/schema';
import { DailyStats } from './admin.types';

@Injectable()
export class AdminNotificationService {
  private readonly logger = new Logger(AdminNotificationService.name);
  private readonly dateFormatter = new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  private missingAdminIdLogged = false;

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly configService: ConfigService,
  ) {}

  async notifyNewUser(user: User): Promise<void> {
    await this.send(
      [
        '👤 <b>Yangi foydalanuvchi</b>',
        '',
        `🆔 ID: <code>${user.id}</code>`,
        `👤 Ism: ${this.formatName(user)}`,
        `📛 Username: ${this.formatUsername(user.username)}`,
        `🌐 Til: ${this.escapeHtml(user.languageCode ?? '—')}`,
        `📅 Vaqt: ${this.formatDate(new Date())}`,
      ].join('\n'),
    );
  }

  async notifyReferral(
    referrer: User,
    newUser: User,
    referrerNewCount: number,
  ): Promise<void> {
    const referralsLeft = Math.max(0, 5 - referrerNewCount);

    await this.send(
      [
        '🔗 <b>Yangi referal</b>',
        '',
        '👑 <b>Taklif qilgan:</b>',
        `• ${this.formatName(referrer)} (${this.formatUsername(referrer.username)})`,
        `• ID: <code>${referrer.id}</code>`,
        `• Holat: <b>${referrerNewCount}/5</b>`,
        '',
        '🆕 <b>Yangi kelgan:</b>',
        `• ${this.formatName(newUser)} (${this.formatUsername(newUser.username)})`,
        `• ID: <code>${newUser.id}</code>`,
        '',
        referrerNewCount >= 5
          ? '🎉 <b>Referal limiti to‘ldi. To‘liq kirish ochildi.</b>'
          : `⏳ Yana <b>${referralsLeft}</b> ta referal kerak`,
      ].join('\n'),
    );
  }

  async notifyFullAccessUnlocked(user: User): Promise<void> {
    await this.send(
      [
        '🔓 <b>To‘liq kirish ochildi</b>',
        '',
        `👤 ${this.formatName(user)}`,
        `📛 ${this.formatUsername(user.username)}`,
        `🆔 ID: <code>${user.id}</code>`,
        '',
        '✅ 5 ta referal yig‘ildi.',
      ].join('\n'),
    );
  }

  async notifyStoryDownload(
    user: User,
    targetUsername: string,
    page: number,
    storyCount: number,
  ): Promise<void> {
    await this.send(
      [
        '📥 <b>Story yuklandi</b>',
        '',
        `👤 ${this.formatName(user)}`,
        `📛 ${this.formatUsername(user.username)} (<code>${user.id}</code>)`,
        `🎯 Maqsad: <code>@${this.escapeHtml(targetUsername)}</code>`,
        `📄 Sahifa: <b>${page + 1}</b>`,
        `🖼 Yuborildi: <b>${storyCount}</b> ta`,
        `📅 Vaqt: ${this.formatDate(new Date())}`,
      ].join('\n'),
    );
  }

  async notifyReferralGateHit(
    user: User,
    targetUsername: string,
    currentCount: number,
  ): Promise<void> {
    const clampedCount = Math.max(0, Math.min(currentCount, 5));

    await this.send(
      [
        '🔒 <b>Referal to‘sig‘i ishga tushdi</b>',
        '',
        `👤 ${this.formatName(user)} (${this.formatUsername(user.username)})`,
        `🆔 ID: <code>${user.id}</code>`,
        `🎯 Maqsad: <code>@${this.escapeHtml(targetUsername)}</code>`,
        `📊 Referallar: <b>${clampedCount}/5</b>`,
        `${'🟩'.repeat(clampedCount)}${'⬜️'.repeat(5 - clampedCount)}`,
      ].join('\n'),
    );
  }

  async notifyError(
    error: Error,
    context: string,
    userId?: number,
  ): Promise<void> {
    await this.send(
      [
        '❌ <b>Xatolik</b>',
        '',
        `📍 Kontekst: <code>${this.escapeHtml(context)}</code>`,
        userId ? `👤 User ID: <code>${userId}</code>` : '',
        `💬 Xabar: <code>${this.escapeHtml(error.message.slice(0, 200))}</code>`,
        `📅 Vaqt: ${this.formatDate(new Date())}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  async notifyBotStarted(): Promise<void> {
    await this.send(
      [
        '🟢 <b>Bot ishga tushdi</b>',
        '',
        `🕐 Vaqt: ${this.formatDate(new Date())}`,
        `🌍 Muhit: <b>${this.escapeHtml(process.env.NODE_ENV ?? 'development')}</b>`,
        `📦 Versiya: <b>${this.escapeHtml(process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.0.1')}</b>`,
      ].join('\n'),
    );
  }

  async notifyBotStopped(signal?: string): Promise<void> {
    await this.send(
      [
        '🔴 <b>Bot to‘xtadi</b>',
        '',
        `⚡ Signal: <code>${this.escapeHtml(signal ?? 'unknown')}</code>`,
        `🕐 Vaqt: ${this.formatDate(new Date())}`,
      ].join('\n'),
    );
  }

  async notifyDailyStats(stats: DailyStats): Promise<void> {
    await this.send(
      [
        '📊 <b>Kunlik statistika</b>',
        `📅 ${this.formatDate(new Date())}`,
        '',
        '━━━━━━━━━━━━━━━━━',
        '👥 <b>Foydalanuvchilar:</b>',
        `• Jami: <b>${stats.totalUsers}</b>`,
        `• Bugun yangi: <b>+${stats.newUsersToday}</b>`,
        `• To‘liq kirish: <b>${stats.usersWithFullAccess}</b>`,
        '',
        '📥 <b>Yuklamalar:</b>',
        `• Bugun: <b>${stats.downloadsToday}</b> ta story`,
        `• Jami sessiyalar: <b>${stats.totalSessions}</b>`,
        '',
        '🔗 <b>Referallar:</b>',
        `• Bugun: <b>+${stats.referralsToday}</b>`,
        `• Jami: <b>${stats.totalReferrals}</b>`,
        '━━━━━━━━━━━━━━━━━',
      ].join('\n'),
    );
  }

  private async send(message: string): Promise<void> {
    const adminId = this.configService.get<number>('admin.telegramId') ?? 0;

    if (!adminId) {
      if (!this.missingAdminIdLogged) {
        this.logger.warn(
          'ADMIN_TELEGRAM_ID not set. Admin notifications skipped.',
        );
        this.missingAdminIdLogged = true;
      }

      return;
    }

    try {
      await this.bot.telegram.sendMessage(adminId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      this.logger.error(
        'Failed to send admin notification',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private formatName(user: User): string {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return this.escapeHtml(fullName || 'Nomsiz');
  }

  private formatUsername(username?: string | null): string {
    return username ? `@${this.escapeHtml(username)}` : '—';
  }

  private formatDate(date: Date): string {
    return this.dateFormatter.format(date);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
