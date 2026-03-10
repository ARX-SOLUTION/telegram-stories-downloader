# AGENTS.md

This file defines working instructions for agents operating anywhere inside this repository.

## Project Overview

- Project type: NestJS Telegram bot + Telegram user client
- Runtime: Node.js + TypeScript
- Bot layer: `nestjs-telegraf` / `telegraf`
- User client layer: `gramjs` via `telegram`
- API base path: `/api`
- Main user-client API base path: `/api/user-client`

This project combines:

1. A Telegram Bot API bot for user-facing chat commands
2. A Telegram MTProto user client for dialogs, messaging, and account actions
3. A REST API used to inspect and control the user client
4. A story downloader flow for fetching Telegram stories by username
5. A referral-gated pagination flow for unlocking additional story pages

## Important Files

- App bootstrap: `src/main.ts`
- Root module: `src/app.module.ts`
- Bot handlers: `src/bot/bot.update.ts`
- Bot module: `src/bot/bot.module.ts`
- User-client service: `src/user-client/user-client.service.ts`
- User-client controller: `src/user-client/user-client.controller.ts`
- User-client DTOs: `src/user-client/user-client.dto.ts`
- Shared user-client routes: `src/user-client/user-client.constants.ts`
- Shared user-client types: `src/user-client/user-client.types.ts`
- Config mapping: `src/config/configuration.ts`
- Environment example: `.env.example`

## Environment

Expected environment variables:

- `PORT`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_LOG_LEVEL` (optional)
- `TELEGRAM_SESSION_STRING` (optional but preferred)
- `SESSION_FILE`

Notes:

- Prefer `TELEGRAM_SESSION_STRING` when the bot should work without asking end-users to login.
- Prefer `TELEGRAM_LOG_LEVEL=warn` or `error` in production to avoid noisy GramJS download logs.
- `SESSION_FILE` is a relative path from the project root unless explicitly changed.
- The MTProto session is persisted to disk. Avoid breaking this flow when refactoring login logic.

## Commands

Use `npm` unless the user explicitly asks for another package manager.

- Install: `npm install`
- Dev server: `npm run start:dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm run test`

When validating changes, prefer:

1. `npm run build`
2. Targeted `npx eslint <changed-files>`
3. Broader lint/test only when useful

## Architecture Notes

### Bot Layer

- Telegram chat commands are handled in `src/bot/bot.update.ts`
- Keep bot replies concise and user-friendly
- Bot messages currently follow an Uzbek-first UX; preserve that unless the user asks otherwise
- When returning formatted Telegram text, use HTML formatting compatible with Telegraf
- `/stories <username>` and `/referral` are implemented in the bot layer and should stay user-friendly and step-based

### User Client Layer

- `UserClientService` owns MTProto client lifecycle, login state, session persistence, and dialogs/messages
- `UserClientService` also owns Telegram story fetching/downloading via GramJS
- Login state is centralized and should remain the single source of truth
- If you add login-related behavior, update both:
  - status/reporting responses
  - bot flow prompts and next actions
- If you add story-related behavior, keep fetching, normalization, error mapping, and media preparation in the service

### REST Layer

- `UserClientController` exposes REST endpoints for user-client actions
- Keep controller methods thin; business logic belongs in the service
- Reuse shared route constants/types when possible instead of duplicating strings

## Coding Rules

- Match the existing NestJS style and keep changes minimal
- Prefer small helper methods over repeating message/state logic
- Keep shared strings and route paths centralized when reused
- Avoid adding unnecessary dependencies
- Do not introduce inline comments unless they add real value
- Do not use one-letter variable names
- Prefer strict, explicit types for public service responses
- Avoid `any` when an obvious local type can be used

## Bot UX Rules

- `/start` should explain the main commands clearly
- `/help` should describe both chat flow and REST alternatives when relevant
- `/status` should show current login state and what to do next
- Avoid making end-users depend on `/login` when a preconfigured session can be used
- `/stories <username>` should explain usage clearly when the argument is missing
- If login is waiting for input, plain text sent in chat may be interpreted as the next login step
- Keep Telegram replies safe for HTML output; escape dynamic content before rendering
- Story-related replies should stay Uzbek-first and include clear progress, empty-state, and error messages

## Story Download Rules

- Use GramJS / MTProto only for story access; do not use scraping or third-party story APIs
- Resolve the peer from username inside `UserClientService`
- Normalize usernames safely:
  - allow `username`
  - allow `@username`
  - allow `https://t.me/username` when useful
- Validate authorization before trying to fetch stories
- Fetch stories through Telegram story APIs, not ad-hoc workarounds
- Download story media through the Telegram client and return typed media objects
- Return newest stories first
- Default to paginated story delivery (5 per page) in the bot UX
- Keep page 0 free and gate page 1+ behind the referral rules
- Support at least:
  - photo stories
  - video stories
- Unsupported story media should fail gracefully or be skipped with safe logging
- User-facing errors should distinguish between:
  - not authorized
  - username not found
  - private / access denied
  - rate limit / flood wait
  - no stories found
- Referral-gated pages should explain how many more invites are needed and show the user referral link
- If temporary files are ever created during story download, they must be cleaned up

## Login Flow Rules

- Supported login states:
  - `idle`
  - `waiting_phone`
  - `waiting_code`
  - `waiting_password`
  - `authorized`
  - `error`
- Do not scatter login-state transitions across multiple files without good reason
- Preserve these behaviors when editing login flow:
  - session restore on startup
  - session persist on success
  - login error capture
  - clear next-action guidance
  - safe handling of phone/code/password submission

## Validation Expectations

For code changes, run the narrowest useful validation first.

Typical validation sequence:

1. `npm run build`
2. `npx eslint src/...changed-file.ts`

If tests are added or affected, run the smallest relevant test command.

## Things To Avoid

- Do not rename API routes casually
- Do not break the `/api` global prefix assumption
- Do not move login logic into the controller
- Do not move story-fetching business logic into the bot handler
- Do not hardcode secrets or real tokens into tracked files
- Do not rewrite unrelated files just for formatting

## When Updating Documentation

Update docs when behavior changes in any of these areas:

- bot commands
- login flow
- story download flow
- environment variables
- REST endpoints

If no full documentation update is needed, at least keep this file accurate.
