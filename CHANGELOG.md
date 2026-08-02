# Changelog

## 2.0.0 — First public release

The 0.1.0 engine never completed a single successful contribution. Every
run timed out waiting for a `.cm-content` element in GitHub's web editor,
and because Telegram was also misconfigured, none of those failures were
ever reported. 2.0.0 replaces the mechanism entirely and prepares the
project for people other than its author.

**Open-source readiness**
- Telegram is now **optional**. Requiring it put a conversation with
  BotFather between a new user and their first working commit. Configure
  both Telegram values or neither; half-configured is rejected, because it
  reads as "I want notifications" while delivering none silently.
- `node manage.js telegram-id` finds your chat ID for you, instead of
  hand-assembling a `getUpdates` URL and reading raw JSON.
- `node manage.js autostart` wires up restart-on-boot in one step and says
  plainly which part still needs `sudo`.
- `TELEGRAM_CHAT_ID` now rejects the `@username` form outright. Telegram
  accepts it only for public channels; against a personal account it fails
  with "chat not found" forever while everything else looks healthy. Public
  channels have numeric IDs too, so nothing is lost.
- README rewritten for people who don't use GitHub often — exact fields,
  exact clicks, exact values.
- Added `LICENSE` (MIT).
- Removed the now-unused `sessions/` directory.

**Changed**
- The GitHub engine now commits through the Contents API instead of
  driving GitHub's web editor with Playwright. No browser, no selectors,
  no cookie session to expire (`src/engine`).
- Authentication is now a fine-grained personal access token scoped to one
  repository with one permission, replacing the interactive browser login
  and the stored session file (`src/auth`). `verifySession` is now
  `verifyGitHubAccess`, and it checks repository access as well as token
  validity; `SessionExpiredError` is now `AuthenticationError`.
- `manage.js check-session` is now `manage.js check-auth`; `manage.js auth`
  prints token-creation steps and verifies the result.
- `manage.js config` masks the GitHub and Telegram tokens.
- Removed the `playwright` dependency and the `HEADLESS`,
  `CHROMIUM_EXECUTABLE_PATH`, and `SESSION_FILE_PATH` settings.

**Added**
- The streak log file is created automatically if it doesn't exist,
  removing the one manual setup step 0.1.0 required.
- A second, independent guard against duplicate commits: the engine reads
  the file before writing and skips committing if today's entry is already
  present, so a lost or restored state file can't cause a double commit.
- `TIMEZONE`, plus optional commit-identity settings, with startup
  validation refusing a combination that would file commits on a different
  day than the one recorded (`src/config`, `src/utils/dates.js`).
- A startup check that logs a loud error when the startup notification
  fails to deliver — the failure mode that hid the broken engine for two
  weeks.
- HTTP failures are now explicitly classified as retryable or not: rate
  limits and 5xx back off, a rejected token stops immediately.

**Fixed**
- "Today" was derived from UTC in `src/state` but local time in the
  logger. Both now come from a single, configurable source
  (`src/utils/dates.js`).
- `.gitignore` now covers `.env.*` backups, which hold the same secrets as
  `.env`.

## 0.1.0 — Initial complete implementation

**Added**
- Centralized, validated configuration (`src/config`).
- Logger with console + daily-rotating file output (`src/utils/logger.js`).
- Reusable retry engine with exponential backoff + jitter, and a
  non-retryable-error escape hatch for cases like an expired session
  (`src/utils/retry.js`).
- State tracking for "has today's contribution happened?", with automatic
  recovery from missing or corrupted state files (`src/state`).
- Telegram notifications for startup, shutdown, success, failure, and
  auth-required — isolated from all business logic, fails silently on its
  own so a Telegram outage never blocks GitHub automation (`src/notify`).
- One-time interactive GitHub authentication via Playwright, plus session
  validity checks (`src/auth`).
- GitHub engine: opens the streak log file in GitHub's web editor, appends
  a daily entry, and commits (`src/engine`).
- Hourly scheduler coordinating the above, with at most one commit per
  calendar day (`src/scheduler`).
- `main.js` application entry point running the full startup sequence.
- `manage.js` control panel (auth, start, stop, restart, run-now, status,
  logs, config, test-telegram, check-session).
- `setup.js` interactive first-run installer.
- `DRY_RUN` and `DEBUG` modes.
- PM2 process definition (`ecosystem.config.js`).
- Full README (installation, auth, configuration, Telegram setup, PM2,
  troubleshooting, security, FAQ).

**Known limitations (see README/chat for detail)**
- `src/engine/index.js`'s selectors are best-effort and unverified against
  a live GitHub session — the file documents exactly how to re-derive them
  with `npx playwright codegen` if GitHub's editor UI has changed.
- No automated health-check command yet (`node manage.js health`) —
  planned for 0.2.
- No local metrics tracking yet — planned for 0.3.
- Telegram is one-directional (notifications only, no `/status` etc.) —
  planned for 0.4.
