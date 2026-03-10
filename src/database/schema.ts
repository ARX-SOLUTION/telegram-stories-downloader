import {
  bigint,
  boolean,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  username: varchar('username', { length: 64 }),
  firstName: varchar('first_name', { length: 128 }),
  lastName: varchar('last_name', { length: 128 }),
  languageCode: varchar('language_code', { length: 10 }),
  referredBy: bigint('referred_by', { mode: 'number' }),
  referralCount: integer('referral_count').default(0).notNull(),
  hasFullAccess: boolean('has_full_access').default(false).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type User = typeof users.$inferSelect;

export interface UpsertTelegramUserInput {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}
