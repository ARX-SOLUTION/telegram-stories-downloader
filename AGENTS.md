# AGENTS.md

This file defines working instructions for every agent operating inside this repository.
Read this file fully before making any changes.

---

## Project Overview

- **Project type:** NestJS Telegram Bot + Telegram MTProto User Client
- **Runtime:** Node.js + TypeScript
- **Bot layer:** `nestjs-telegraf` / `telegraf`
- **User client layer:** `gramjs` via `telegram`
- **API base path:** `/api`
- **User-client API base path:** `/api/user-client`

This project combines:

1. A Telegram Bot API bot for user-facing chat commands
2. A Telegram MTProto user client for dialogs, stories, and account actions
3. A REST API to inspect and control the user client externally

---

## Important Files

| File                                        | Purpose                                |
| ------------------------------------------- | -------------------------------------- |
| `src/main.ts`                               | App bootstrap                          |
| `src/app.module.ts`                         | Root NestJS module                     |
| `src/database/database.module.ts`           | Drizzle + NeonDB database module       |
| `src/database/schema.ts`                    | Drizzle schema definitions             |
| `src/database/user.repository.ts`           | All database reads/writes for users    |
| `src/bot/bot.update.ts`                     | Bot command and event handlers         |
| `src/bot/bot.module.ts`                     | Bot NestJS module                      |
| `src/bot/bot-messages.ts`                   | All user-facing message strings        |
| `src/bot/bot-keyboards.ts`                  | All inline keyboard definitions        |
| `src/admin/admin.module.ts`                 | Admin notification module              |
| `src/admin/admin-notification.service.ts`   | Admin Telegram notifications           |
| `src/admin/admin-stats.service.ts`          | Scheduled admin stats sender           |
| `src/user-client/user-client.service.ts`    | MTProto client lifecycle + story logic |
| `src/user-client/user-client.controller.ts` | REST endpoints for user client         |
| `src/user-client/user-client.dto.ts`        | Request/response DTOs                  |
| `src/user-client/user-client.constants.ts`  | Shared route constants                 |
| `src/user-client/user-client.types.ts`      | Shared TypeScript types                |
| `src/referral/referral.service.ts`          | Referral tracking and access gate      |
| `src/config/configuration.ts`               | Environment config mapping             |
| `.env.example`                              | Environment variable template          |
| `.github/pull_request_template.md`          | PR template                            |

---

## Environment Variables

| Variable                  | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `PORT`                    | HTTP server port                                                     |
| `ADMIN_TELEGRAM_CHAT_ID`  | Optional dedicated Telegram group/channel chat ID for admin alerts   |
| `ADMIN_TELEGRAM_ID`       | Legacy fallback for admin notifications                              |
| `DATABASE_URL`            | NeonDB/PostgreSQL connection string                                  |
| `TELEGRAM_API_ID`         | MTProto App ID from my.telegram.org                                  |
| `TELEGRAM_API_HASH`       | MTProto App Hash from my.telegram.org                                |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather                                            |
| `TELEGRAM_SESSION_STRING` | Optional pre-authorized MTProto session string                       |
| `TELEGRAM_LOG_LEVEL`      | Optional GramJS log level (`none`, `error`, `warn`, `info`, `debug`) |
| `SESSION_FILE`            | Relative path to MTProto session file                                |
| `YOUTUBE_COOKIES_FILE`    | Optional Netscape-format cookies file for restricted YouTube media   |
| `YOUTUBE_COOKIES_FROM_BROWSER` | Optional `yt-dlp` browser cookie source for dev machines       |
| `YOUTUBE_EXTRACTOR_CLIENTS` | Optional `yt-dlp` YouTube extractor client list                    |

Notes:

- `SESSION_FILE` is relative to the project root unless explicitly changed
- `ADMIN_TELEGRAM_CHAT_ID` is the preferred target for admin alerts
- Positive `ADMIN_TELEGRAM_ID` private-user targets are ignored by default to keep admin logs out of the bot DM
- `DATABASE_URL` is required when running the Drizzle-backed user persistence and referral flow
- The MTProto session is persisted to disk — never break this flow when refactoring login logic
- Prefer `TELEGRAM_SESSION_STRING` when the bot should run without asking end-users to login
- Prefer `TELEGRAM_LOG_LEVEL=warn` or `error` in production to reduce noisy GramJS logs
- Restricted YouTube media may require `YOUTUBE_COOKIES_FILE` on the server
- Never hardcode secrets or real tokens into tracked files

---

## Commands

Use `npm` unless the user explicitly asks for another package manager.

| Command             | Purpose                     |
| ------------------- | --------------------------- |
| `npm install`       | Install dependencies        |
| `npm run start:dev` | Start dev server with watch |
| `npm run build`     | Compile TypeScript          |
| `npm run lint`      | Run ESLint across project   |
| `npm run test`      | Run test suite              |

When validating changes, prefer:

1. `npm run build`
2. `npx eslint src/<changed-file>.ts`
3. Broader lint/test only when useful

---

## Architecture

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────┐
│                   Telegram Chat                     │
│         (commands, text messages, callbacks)        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              bot.update.ts (Bot Layer)               │
│  - Parse input                                      │
│  - Check state                                      │
│  - Call services                                    │
│  - Format replies using BotMessages + BotKeyboards  │
└──────────┬───────────────────────┬──────────────────┘
           │                       │
┌──────────▼──────────┐ ┌─────────▼──────────────────┐
│  UserClientService  │ │      ReferralService        │
│  - MTProto client   │ │  - Access gate logic        │
│  - Login state      │ │  - Generate referral links  │
│  - Story fetch      │ │  - Delegate to repository   │
│  - Session persist  │ └────────────────────────────┘
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│    UserRepository   │
│  - Upsert bot users │
│  - Referral counts  │
│  - NeonDB access    │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ UserClientController│
│  - REST endpoints   │
│  - Thin methods     │
└─────────────────────┘
```

### Bot Layer

- All Telegram commands and events are handled in `src/bot/bot.update.ts`
- `bot.update.ts` must stay thin — only parse input, call services, send replies
- All reply strings come from `BotMessages.*` — never hardcode strings in handlers
- All keyboards come from `BotKeyboards.*` — never hardcode inline keyboards in handlers
- Every `ctx.reply()` and `ctx.editMessageText()` must use `{ parse_mode: 'HTML' }`
- Escape all dynamic content (usernames, phone numbers, links) with `escapeHtml()` before rendering
- YouTube downloads use `yt-dlp`; auth-gated videos should rely on env-configured cookies, not hardcoded credentials

### User Client Layer

- `UserClientService` owns MTProto client lifecycle, login state, session persistence, and story fetching
- Login state is centralized — single source of truth
- If you add login-related behavior, update both status reporting and bot flow prompts
- Story fetch always returns newest-first (sorted by `date` descending) before pagination

### Referral Layer

- `ReferralService` is a standalone injectable service
- `ReferralService` must delegate persistence to `UserRepository`
- Free limit: first 5 stories (page 0) always free
- Page 1+ requires `referralCount >= 5`
- Self-referral is silently ignored
- The same referred user must never count twice

### Database Layer

- ORM: Drizzle ORM
- Provider: NeonDB PostgreSQL
- Schema lives in `src/database/schema.ts`
- Connection wiring lives in `src/database/database.module.ts`
- All database access goes through `UserRepository`
- Story download sessions are logged via `UserRepository` for admin stats
- Never inject the `DRIZZLE` token directly into handlers or controllers

### Admin Layer

- `AdminNotificationService` sends Telegram alerts for new users, referrals, downloads, errors, and lifecycle events
- `AdminStatsService` sends daily stats in the `Asia/Tashkent` timezone
- Admin alerts should go to a dedicated group/channel chat via `ADMIN_TELEGRAM_CHAT_ID`
- Admin notifications must never crash the app; failures are logged and swallowed

### REST Layer

- `UserClientController` exposes REST endpoints for user-client actions
- Keep controller methods thin — business logic belongs in the service
- Reuse shared route constants from `user-client.constants.ts`
- Never move login logic into the controller

### Message & Keyboard Layer

- `BotMessages` contains pure functions returning HTML strings
- `BotKeyboards` contains pure functions returning Telegraf keyboard configs
- Every message should answer:
  1. What happened?
  2. What is the current state?
  3. What should the user do next?
- Uzbek-first UX is the default unless the user explicitly requests otherwise

---

## Login Flow

### Supported States

| State              | Meaning                     |
| ------------------ | --------------------------- |
| `idle`             | Not started                 |
| `waiting_phone`    | Awaiting phone number input |
| `waiting_code`     | Awaiting SMS/Telegram code  |
| `waiting_password` | Awaiting 2FA password       |
| `authorized`       | Logged in successfully      |
| `error`            | Login failed                |

### Rules

- Do not scatter login state transitions across multiple files
- Preserve these behaviors when editing login flow:
  - Session restore on startup
  - Session persist on success
  - Login error capture with reason
  - Clear next-action guidance in every state
  - Safe handling of phone/code/password submission

---

## Story Download Flow

### Order

- Always fetch: active → pinned → archived (if peer type supports archive fetching)
- Always deduplicate by story ID before downloading
- Always sort newest-first before slicing pages

### Pagination

- Page size: `5` stories per page (`STORIES_PER_PAGE = 5`)
- Page 0: always free, no referral check
- Page 1+: referral gate applied
- Archive fetch uses offset pagination — loop until `items.length < limit`

### Sending

- Video `<= 50MB` → send as video
- Video `> 50MB` → send as document
- Photo → send as photo
- Add `sleep(400ms)` between story sends to reduce Telegram rate-limit pressure

---

## Referral System

### Flow

```
User A shares link → https://t.me/BotUsername?start=ref_<userIdA>
User B clicks link → bot receives /start ref_<userIdA>
Bot calls ReferralService.registerReferral(userIdA, userIdB)
User A's count increases by 1
When count reaches 5 → User A gains full story access
```

### Persistence Rules

- Always upsert the Telegram user on `/start`
- `UserRepository` is the single source of truth for user rows and referral counters
- `has_full_access` is persisted in the database and treated as canonical
- Do not reintroduce in-memory `Map`-based referral state

### Referral Gate UI Must Include

- Visual progress bar using emoji (`🟩` filled, `⬜️` empty)
- Current count and percentage
- Share button using `t.me/share/url`
- Refresh button that updates the message in place via `ctx.editMessageText()`
- Copy button that sends the referral link back as a `<code>` block

---

## Bot Commands

| Command              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `/start`             | Welcome message and referral payload detection |
| `/stories @username` | Download stories                               |
| `/referral`          | Show referral status and share link            |
| `/status`            | Show current login state and next action       |
| `/login`             | Start login flow step by step                  |
| `/cancel`            | Cancel current login flow                      |
| `/help`              | Full help with commands and usage              |

### Smart Text Handler

- Any plain text message matching a Telegram username should trigger story download
- Any plain text message containing a supported YouTube link should trigger YouTube media download
- Messages starting with `/` are skipped and handled as commands
- Short words under 5 characters are silently ignored
- `@username`, `https://t.me/<username>`, `http://t.me/<username>`, and `t.me/<username>` are accepted by the story handler

---

## Inline Mode

- `BotMessages` contains inline-related copy, but `bot.update.ts` does **not** currently implement inline query handlers
- Do not assume inline mode is active or documented as available until `@InlineQuery()` / related handlers are actually wired
- If inline mode is added later, update this file, bot help text, and bot settings-related docs together

---

## Coding Rules

- Match existing NestJS style — keep changes minimal and focused
- Prefer small helper methods over repeated logic
- Keep shared strings in `BotMessages`, shared keyboards in `BotKeyboards`
- Keep shared route paths in `user-client.constants.ts`
- Avoid adding unnecessary dependencies
- Do not introduce inline comments unless they add real value
- Do not use one-letter variable names
- Prefer strict, explicit types for all public service methods
- Avoid `any` — define a local type when needed
- All DB access must go through `UserRepository`
- Keep controller methods thin — delegate to services immediately

---

## TypeScript Types Reference

```ts
type LoginState =
  | 'idle'
  | 'waiting_phone'
  | 'waiting_code'
  | 'waiting_password'
  | 'authorized'
  | 'error';

type StoryMediaItem = {
  id: number;
  date: number;
  isPinned: boolean;
  isExpired: boolean;
  media: Api.TypeMessageMedia;
  storyItem: Api.StoryItem;
};

type StoryDownloadResult = {
  storyId: number;
  date: number;
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

type PaginatedStoriesResult = {
  stories: StoryDownloadResult[];
  page: number;
  total: number;
  hasMore: boolean;
  pagesCount: number;
};

type StoryFetchStatus = {
  username: string;
  total: number;
  downloaded: number;
  failed: number;
};
```

---

## Database

- ORM: Drizzle ORM
- Provider: NeonDB (PostgreSQL serverless)
- Schema file: `src/database/schema.ts`
- DB module: `src/database/database.module.ts`
- Repository: `src/database/user.repository.ts`
- Migration output: `./drizzle/`
- Config: `drizzle.config.ts`

### Migration Commands

- Generate: `npx drizzle-kit generate`
- Push to DB: `npx drizzle-kit push`
- Studio UI: `npx drizzle-kit studio`

### Rules

- Never use raw SQL strings in handlers or controllers
- All DB access goes through `UserRepository`
- `ReferralService` must use `UserRepository`
- Always use user upsert on `/start`

---

## Git Workflow

Every code change — no matter how small — must follow this workflow.

### Branch Naming

Format: `<type>/<short-description>`

| Prefix      | When to use                     |
| ----------- | ------------------------------- |
| `feat/`     | New feature                     |
| `fix/`      | Bug fix                         |
| `refactor/` | Restructure, no behavior change |
| `chore/`    | Config, deps, tooling           |
| `docs/`     | Documentation only              |

Examples:

- `feat/story-pagination`
- `feat/referral-gate`
- `fix/inline-query-empty-input`
- `refactor/bot-messages-centralize`
- `docs/update-agents-md`

### Required Steps

```bash
# 1. Pull latest main
git checkout main
git pull origin main

# 2. Create branch
git checkout -b feat/your-feature-name

# 3. Make changes

# 4. Validate
npm run build
npx eslint src/<changed-file>.ts

# 5. Commit
git add .
git commit -m "<type>(<scope>): <short description>"

# 6. Push
git push origin feat/your-feature-name

# 7. Open Pull Request on GitHub
```

### Commit Message Format

Follow Conventional Commits:

```text
<type>(<scope>): <short description>
```

Examples:

```text
feat(stories): add pagination with 5 stories per page
feat(referral): gate story page 2+ behind referral count
feat(inline): add inline query support for story download
fix(inline): handle empty username query gracefully
refactor(bot): centralize all messages into bot-messages.ts
chore(bot): update BotFather commands list in help
docs(agents): add git workflow and coding rules
```

### Pull Request Rules

- Title must match commit message format
- Body must use `.github/pull_request_template.md`
- `npm run build` must pass before opening PR
- One feature = one branch = one PR
- Keep PRs small and focused
- Delete branch after merge
- Never force push to `main`
- Never commit directly to `main`
- Never merge your own PR without review when working in a team

---

## PR Template (`.github/pull_request_template.md`)

```markdown
## Summary

<!-- What does this PR do? 1-2 sentences -->

## Changes

<!-- List each changed file and why -->

- `src/` —

## Type

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor — no behavior change
- [ ] docs — documentation
- [ ] chore — config/tooling

## Validation

- [ ] `npm run build` passed
- [ ] `npx eslint <changed-files>` passed
- [ ] Tested manually in Telegram

## Related

Closes #
```

---

## Validation Sequence

For every change, run in this order:

1. `npm run build` — always required
2. `npx eslint src/...changed-file.ts` — targeted lint
3. `npm run test` — only when tests are added or affected

Never skip step 1 before committing.

---

## Production Checklist

### Build & Config

- `npm run build` passes with zero errors
- Required env vars are validated on startup
- `NODE_ENV=production` is set in production deploys
- No secrets are committed to tracked files

### Security

- `helmet()` is enabled when exposing HTTP endpoints publicly
- CORS stays disabled unless a browser client explicitly requires it
- Global `ValidationPipe` keeps `whitelist: true`
- Sensitive production errors do not expose stack traces to clients

### Database

- Run `npx drizzle-kit push` before deploys that change schema
- `DATABASE_URL` must use Neon/PostgreSQL SSL settings in production
- DB reads and writes go through `UserRepository`
- Repository methods should fail clearly and log safely on DB errors

### Bot

- MTProto session persistence remains intact and is backed up
- Graceful shutdown disconnects the Telegram user client cleanly
- Run a single bot instance in PM2 fork mode unless the bot is made multi-instance safe

### PM2

- `ecosystem.config.cjs` stays committed and current
- `max_memory_restart` is configured for production
- `autorestart` remains enabled
- Run `pm2 save` after successful start
- Run `pm2 startup` on servers that must survive reboots

### Monitoring

- `GET /api/health` should return `200` in production
- PM2 logs should be rotated or managed externally
- Error logs should be monitored after deploys

### Deploy

- Use a repeatable deploy script or a fixed deploy sequence
- Run a health check after every deploy
- Keep a rollback path ready: revert, rebuild, restart

---

## Things To Avoid

- Do not commit directly to `main`
- Do not open PRs without passing `npm run build`
- Do not combine unrelated changes in one PR
- Do not rename API routes casually
- Do not break the `/api` global prefix assumption
- Do not move login logic into the controller
- Do not hardcode secrets or real tokens into tracked files
- Do not rewrite unrelated files just for formatting
- Do not use `any` when an obvious local type can be used
- Do not hardcode reply strings — always use `BotMessages.*`
- Do not hardcode keyboards — always use `BotKeyboards.*`
- Do not bypass `UserRepository` for database writes
- Do not send Telegram replies without `parse_mode: 'HTML'`
- Do not render dynamic content without `escapeHtml()`
- Do not merge your own PR without review in a team setting

---

## When to Update This File

Update `AGENTS.md` when behavior changes in any of these areas:

- Bot commands (add, remove, rename)
- Login flow states or transitions
- Environment variables (add, remove, rename)
- REST endpoints (add, remove, rename)
- Architecture layers or responsibilities
- Git workflow rules
- Coding rules or type definitions

If no full update is needed, at minimum keep the **Important Files** table accurate.
