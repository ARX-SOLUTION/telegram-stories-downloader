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
| `src/bot/bot.update.ts`                     | Bot command and event handlers         |
| `src/bot/bot.module.ts`                     | Bot NestJS module                      |
| `src/bot/bot-messages.ts`                   | All user-facing message strings        |
| `src/bot/bot-keyboards.ts`                  | All inline keyboard definitions        |
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
| `TELEGRAM_API_ID`         | MTProto App ID from my.telegram.org                                  |
| `TELEGRAM_API_HASH`       | MTProto App Hash from my.telegram.org                                |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather                                            |
| `TELEGRAM_SESSION_STRING` | Optional pre-authorized MTProto session string                       |
| `TELEGRAM_LOG_LEVEL`      | Optional GramJS log level (`none`, `error`, `warn`, `info`, `debug`) |
| `SESSION_FILE`            | Relative path to MTProto session file                                |

Notes:

- `SESSION_FILE` is relative to the project root unless explicitly changed
- The MTProto session is persisted to disk — never break this flow when refactoring login logic
- Prefer `TELEGRAM_SESSION_STRING` when the bot should run without asking end-users to login
- Prefer `TELEGRAM_LOG_LEVEL=warn` or `error` in production to reduce noisy GramJS logs
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
│  - MTProto client   │ │  - Track referral counts    │
│  - Login state      │ │  - Access gate logic        │
│  - Story fetch      │ │  - Generate referral links  │
│  - Session persist  │ └────────────────────────────┘
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

### User Client Layer

- `UserClientService` owns MTProto client lifecycle, login state, session persistence, and story fetching
- Login state is centralized — single source of truth
- If you add login-related behavior, update both status reporting and bot flow prompts
- Story fetch always returns newest-first (sorted by `date` descending) before pagination

### Referral Layer

- `ReferralService` is a standalone injectable service
- It currently uses an in-memory `Map<number, Set<number>>` model — keep the DB replacement note explicit
- Free limit: first 5 stories (page 0) always free
- Page 1+ requires `referralCount >= 5`
- Self-referral is silently ignored
- The same referred user must never count twice

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
- Messages starting with `/` are skipped and handled as commands
- Short words under 5 characters are silently ignored
- `https://t.me/<username>` links are also accepted by the current bot handler

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
