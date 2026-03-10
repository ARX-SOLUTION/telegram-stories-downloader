import {
  bigint,
  boolean,
  integer,
  pgTable,
  serial,
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

export const storyDownloadSessions = pgTable('story_download_sessions', {
  id: serial('id').primaryKey(),
  userId: bigint('user_id', { mode: 'number' })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetUsername: varchar('target_username', { length: 64 }).notNull(),
  page: integer('page').notNull(),
  storyCount: integer('story_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type StoryDownloadSession = typeof storyDownloadSessions.$inferSelect;

export interface UpsertTelegramUserInput {
  id: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}

export interface LogStoryDownloadSessionInput {
  userId: number;
  targetUsername: string;
  page: number;
  storyCount: number;
}
