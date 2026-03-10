import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DailyStats } from '../admin/admin.types';
import { DRIZZLE } from './database.constants';
import * as schema from './schema';
import {
  LogStoryDownloadSessionInput,
  storyDownloadSessions,
  UpsertTelegramUserInput,
  User,
  users,
} from './schema';

@Injectable()
export class UserRepository {
  private static readonly REQUIRED_REFERRALS = 5;

  constructor(
    @Inject(DRIZZLE)
    private readonly db: NeonHttpDatabase<typeof schema>,
  ) {}

  async upsertUser(data: UpsertTelegramUserInput): Promise<User> {
    const [user] = await this.db
      .insert(users)
      .values({
        id: data.id,
        username: data.username ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        languageCode: data.languageCode ?? null,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          username: data.username ?? null,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          languageCode: data.languageCode ?? null,
          lastSeenAt: new Date(),
        },
      })
      .returning();

    return user;
  }

  async findById(id: number): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? null;
  }

  async registerReferral(
    referrerId: number,
    newUserId: number,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(referrerId) ||
      !Number.isSafeInteger(newUserId) ||
      referrerId <= 0 ||
      newUserId <= 0 ||
      referrerId === newUserId
    ) {
      return false;
    }

    const referrer = await this.findById(referrerId);
    if (!referrer) {
      return false;
    }

    const [updatedUser] = await this.db
      .update(users)
      .set({
        referredBy: referrerId,
        lastSeenAt: new Date(),
      })
      .where(and(eq(users.id, newUserId), isNull(users.referredBy)))
      .returning({ id: users.id });

    if (!updatedUser) {
      return false;
    }

    await this.db
      .update(users)
      .set({
        referralCount: sql`${users.referralCount} + 1`,
        hasFullAccess: sql<boolean>`${users.referralCount} + 1 >= ${UserRepository.REQUIRED_REFERRALS}`,
      })
      .where(eq(users.id, referrerId));

    return true;
  }

  async getReferralCount(userId: number): Promise<number> {
    const user = await this.findById(userId);
    return user?.referralCount ?? 0;
  }

  async hasFullAccess(userId: number): Promise<boolean> {
    const user = await this.findById(userId);
    return user?.hasFullAccess ?? false;
  }

  async getAllUsers(): Promise<User[]> {
    return this.db.select().from(users);
  }

  async getTotalUserCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    return Number(result?.count ?? 0);
  }

  async logStoryDownloadSession(
    data: LogStoryDownloadSessionInput,
  ): Promise<void> {
    await this.db.insert(storyDownloadSessions).values({
      userId: data.userId,
      targetUsername: data.targetUsername,
      page: data.page,
      storyCount: data.storyCount,
    });
  }

  async getDailyStats(): Promise<DailyStats> {
    const dayStart = this.getTashkentDayStart();

    const [
      totalUsersResult,
      newUsersTodayResult,
      usersWithFullAccessResult,
      downloadsTodayResult,
      totalSessionsResult,
      referralsTodayResult,
      totalReferralsResult,
    ] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)` }).from(users),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(gte(users.firstSeenAt, dayStart)),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.hasFullAccess, true)),
      this.db
        .select({
          total: sql<number>`coalesce(sum(${storyDownloadSessions.storyCount}), 0)`,
        })
        .from(storyDownloadSessions)
        .where(gte(storyDownloadSessions.createdAt, dayStart)),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(storyDownloadSessions),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(
          and(isNotNull(users.referredBy), gte(users.firstSeenAt, dayStart)),
        ),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(isNotNull(users.referredBy)),
    ]);

    return {
      totalUsers: Number(totalUsersResult[0]?.count ?? 0),
      newUsersToday: Number(newUsersTodayResult[0]?.count ?? 0),
      usersWithFullAccess: Number(usersWithFullAccessResult[0]?.count ?? 0),
      downloadsToday: Number(downloadsTodayResult[0]?.total ?? 0),
      totalSessions: Number(totalSessionsResult[0]?.count ?? 0),
      referralsToday: Number(referralsTodayResult[0]?.count ?? 0),
      totalReferrals: Number(totalReferralsResult[0]?.count ?? 0),
    };
  }

  private getTashkentDayStart(referenceDate = new Date()): Date {
    const tashkentOffsetMs = 5 * 60 * 60 * 1000;
    const shiftedDate = new Date(referenceDate.getTime() + tashkentOffsetMs);
    shiftedDate.setUTCHours(0, 0, 0, 0);

    return new Date(shiftedDate.getTime() - tashkentOffsetMs);
  }
}
