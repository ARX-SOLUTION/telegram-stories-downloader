import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { DRIZZLE } from './database.constants';
import * as schema from './schema';
import { UpsertTelegramUserInput, User, users } from './schema';

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
}
