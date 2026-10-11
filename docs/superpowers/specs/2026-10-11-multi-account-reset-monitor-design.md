# Multi-account Codex reset monitor design

## Goal

Extend `codex-reset-signal` into a zero-X-API-cost monitor for several public X accounts. The monitor must detect announcements about Codex usage-limit resets or increases, send deduplicated Telegram alerts, and run on GitHub Actions without storing an X login cookie.

## Scope

The first deployment monitors these handles by default:

- `thsottiaux`
- `sama`
- `gdb`
- `OpenAI`
- `OpenAIDevs`
- `dkundel`

The account list remains configurable through `X_USERNAMES`. Existing single-account `X_USERNAME` configuration remains supported for compatibility.

The first deployment uses FxEmbed only. It does not automatically fall back to the paid X API and does not use X session cookies.

Telegram is the deployment notification channel. Existing Discord, webhook, email, SMS, RSS, and dashboard support remain available but are not expanded in this change.

## Signal detection

Detection should capture clear announcements about Codex capacity or usage limits, including phrases such as:

- reset or reset bank
- usage limit or rate limit reset
- quota or credits reset
- limits increased, doubled, raised, or refreshed
- more capacity or additional capacity
- Chinese equivalents such as `额度重置`, `配额重置`, and `额度提高`

Matching is case-insensitive. A generic word such as `credits` or `limit` alone is not sufficient; it must appear in an allowed phrase or in a post that also contains a reset/increase concept. The existing structured reset-event parser remains authoritative for `MATCH_WORD=reset` compatibility.

## Configuration

Add these settings:

- `X_USERNAMES`: comma-separated handles. Defaults to the six handles above.
- `MATCH_PHRASES`: optional comma-separated custom phrases. Defaults to the reset/capacity phrase set.

Compatibility rules:

1. If `X_USERNAMES` is present, use it.
2. Otherwise, if `X_USERNAME` is present, monitor that one account.
3. Otherwise, use the default account list.

Handles are normalized by removing a leading `@`, deduplicated case-insensitively, and validated against X handle syntax. Empty lists and invalid handles fail configuration validation before network calls.

## State model and data flow

Each account has an independent source identity and cursor. A single shared cursor is prohibited because post IDs from one account could advance another account past unseen posts.

The runtime state stores an account map keyed by normalized lowercase handle. Each account entry contains its user ID, `sinceId`, latest observed post, scan count, and last successful check. Matches, delivery outbox entries, and the global seen map remain shared so notifications are deduplicated across all accounts.

For every scheduled run:

1. Load and migrate existing v2 single-account state if present.
2. Process configured accounts sequentially to avoid unnecessary load on FxEmbed.
3. Resolve and cache each user ID.
4. Fetch only posts newer than that account's cursor.
5. Evaluate each post with the reset/capacity matcher.
6. Add new matches to the shared outbox.
7. Persist state after each account so a later account failure does not discard earlier progress.
8. Deliver pending notifications and checkpoint each successful destination.

A failed account does not prevent other accounts from being checked. The run finishes with an error after saving all successful progress, allowing GitHub Actions to expose the degraded state.

## Notifications

Telegram alerts include:

- display handle
- original post text
- matched signal category or phrase
- source post time
- original `x.com` link

No media is downloaded. Telegram credentials are read only from `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_IDS`; they are never written to state, logs, summaries, fixtures, or public dashboard output.

## GitHub Actions deployment

The existing workflow remains the scheduler and runtime host. Repository variables configure accounts and phrases; repository secrets configure Telegram. Runtime state stays on the isolated `monitor-state` branch.

The workflow keeps its approximately five-minute schedule. GitHub may delay scheduled jobs, so the system is near-real-time rather than guaranteed real-time.

The deployment procedure is:

1. Push this repository to a user-owned GitHub repository.
2. Create the `monitor-state` branch with initial runtime files.
3. Add Telegram secrets and optional repository variables.
4. Enable Actions and run the workflow manually once.
5. Confirm the initial run bootstraps without historical notification spam.

## Security requirements

- No X cookies or paid API token are required for the selected source.
- All notification credentials remain in GitHub Secrets.
- Webhook URL validation and secret redaction remain intact.
- Network responses continue to receive schema and freshness validation.
- Dependency installation uses the committed lock file through `npm ci`.
- A dependency audit is performed before deployment, and high/critical findings block deployment unless explicitly accepted.

FxEmbed is an unofficial third-party dependency with no service-level guarantee. X native post notifications should remain enabled as a manual fallback.

## Tests and acceptance criteria

Tests are written before implementation and must demonstrate:

- account-list parsing, normalization, deduplication, and validation;
- backward compatibility with `X_USERNAME`;
- independent cursors for at least two accounts;
- one account failure does not block successful accounts;
- matching of reset/increase phrases and rejection of unrelated uses of `credit` or `limit`;
- notification text identifies the source account;
- migration from the existing single-account state;
- no duplicate notification across repeated runs;
- bootstrap does not send historical alerts by default.

Before deployment, `npm test`, `npm run typecheck`, `npm run build`, and `npm audit --audit-level=high` must complete successfully. A dry run with fixture data must show the expected matches without sending a real Telegram message.

## Out of scope

- Guaranteed delivery or real-time latency from X
- Browser automation or X-cookie scraping
- AI-generated summaries or translations
- A new dashboard design
- SMS or email provider setup
- Automatic paid fallback to the official X API
