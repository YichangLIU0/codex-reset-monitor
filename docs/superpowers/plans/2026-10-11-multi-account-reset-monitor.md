# Multi-account Codex Reset Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor six configurable X accounts for credible Codex usage-limit reset or increase announcements and deliver deduplicated Telegram alerts without an X API token or cookie.

**Architecture:** Extend configuration with a normalized account list and phrase matcher, migrate runtime state to a per-account cursor map, and have the monitor process accounts sequentially while retaining one shared delivery outbox. Preserve the existing FxEmbed source, notification adapters, dashboard projections, and single-account environment-variable compatibility.

**Tech Stack:** Node.js 22, TypeScript, Vitest, FxEmbed, GitHub Actions, Telegram Bot API

**Spec:** `docs/superpowers/specs/2026-10-11-multi-account-reset-monitor-design.md`

## Global Constraints

- Default accounts are `thsottiaux,sama,gdb,OpenAI,OpenAIDevs,Codex`.
- FxEmbed remains the default source; there is no automatic paid fallback and no X cookie support.
- Telegram secrets must only come from `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_IDS`.
- Existing `X_USERNAME` and `MATCH_WORD=reset` behavior remains compatible.
- Runtime progress is persisted after each account and before notification delivery.
- New behavior follows red-green-refactor TDD.

## File map

- `src/config.ts`: parse and validate multi-account and phrase configuration.
- `src/types.ts`: define `AccountState`, v3 `MonitorState`, and new `AppConfig` fields.
- `src/signal-matcher.ts`: focused default/custom reset-capacity phrase matching.
- `src/state.ts`: create v3 state and migrate v2 single-account state.
- `src/monitor.ts`: sequential per-account collection, partial-failure persistence, and shared outbox delivery.
- `src/notifications.ts`: retain channel adapters and ensure alerts derive the handle from the post URL.
- `tests/config.test.ts`, `tests/signal-matcher.test.ts`, `tests/state.test.ts`, `tests/monitor-multi-account.test.ts`: behavioral coverage.
- `.github/workflows/monitor.yml`, `monitor.env.example`, `README.md`, `README.zh-CN.md`: deployment configuration and instructions.

---

### Task 1: Multi-account configuration and signal matcher

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Create: `src/signal-matcher.ts`
- Modify: `tests/config.test.ts`
- Create: `tests/signal-matcher.test.ts`

**Interfaces:**
- Produces: `AppConfig.usernames: string[]`, `AppConfig.matchPhrases: string[]`.
- Produces: `matchesResetSignal(text: string, phrases: string[]): boolean`.

- [ ] **Step 1: Write failing configuration tests**

Add tests asserting that `X_USERNAMES="@sama,gdb,SAMA"` becomes `["sama", "gdb"]`, `X_USERNAME` remains a one-account fallback, default configuration contains all six handles, and invalid/empty explicitly supplied lists fail validation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL because `usernames` and multi-account validation do not exist.

- [ ] **Step 3: Implement minimal configuration support**

Add normalized, case-insensitive handle deduplication. Keep `config.username` as `config.usernames[0]` for existing presentation code. Parse `MATCH_PHRASES` as an optional comma-separated list.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- tests/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing phrase-matcher tests**

Cover `usage limits reset`, `rate limit has been reset`, `limits doubled`, `more Codex capacity`, `额度重置`, and `配额提高`; reject unrelated sentences such as `credit card limit changed` and `the movie credits reset the mood`.

- [ ] **Step 6: Run the matcher test and verify RED**

Run: `npm test -- tests/signal-matcher.test.ts`

Expected: FAIL because `src/signal-matcher.ts` does not exist.

- [ ] **Step 7: Implement the minimal matcher**

Use a compact built-in regex set plus escaped custom phrase matching. Require reset/increase/capacity intent for generic `limit`, `quota`, or `credits` terms.

- [ ] **Step 8: Run focused tests and commit**

Run: `npm test -- tests/config.test.ts tests/signal-matcher.test.ts`

Expected: PASS.

Commit: `feat: add multi-account signal configuration`

---

### Task 2: Version 3 per-account runtime state

**Files:**
- Modify: `src/types.ts`
- Modify: `src/state.ts`
- Create: `tests/state.test.ts`
- Modify: existing state-dependent tests as required for the new schema

**Interfaces:**
- Produces: `AccountState` with `username`, `userId`, `sinceId`, `lastCheckedAt`, `lastSuccessAt`, `lastRunStatus`, `postsScanned`, and `latestObservedPost`.
- Produces: `MonitorState.version: 3` and `MonitorState.accounts: Record<string, AccountState>`.
- Produces: `readState(path, usernames, keyword)` that accepts `string[]` and migrates v2 state.

- [ ] **Step 1: Write failing state tests**

Assert that a new state creates one independent entry per normalized handle, a v2 state migrates its cursor into the matching first account, and adding a newly configured account does not invalidate existing state.

- [ ] **Step 2: Run the state test and verify RED**

Run: `npm test -- tests/state.test.ts`

Expected: FAIL because the v3 account map is absent.

- [ ] **Step 3: Implement v3 state and migration**

Preserve matches, outbox, and seen data. Reject malformed account cursor values. Remove state rejection based solely on a changed configured account list; initialize missing accounts and retain inactive entries for safe reconfiguration.

- [ ] **Step 4: Update affected fixtures and verify GREEN**

Run: `npm test -- tests/state.test.ts tests/monitor.test.ts tests/public-status.test.ts tests/dashboard-state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: store independent account cursors`

---

### Task 3: Sequential multi-account monitoring and partial failures

**Files:**
- Modify: `src/monitor.ts`
- Modify: `src/public-status.ts`
- Create: `tests/monitor-multi-account.test.ts`
- Modify: `tests/monitor.test.ts`
- Modify: `tests/monitor-detection.test.ts`
- Modify: `tests/parser-migration.test.ts`

**Interfaces:**
- Consumes: `AppConfig.usernames`, `MonitorState.accounts`, `matchesResetSignal`.
- Produces: `runMonitor(config, deps)` that invokes `resolveUserId` and `getPosts` once per configured account and persists each successful account independently.

- [ ] **Step 1: Write failing two-account cursor test**

Use a source fake that returns different user IDs and newest IDs for `sama` and `gdb`; assert each account retains its own cursor and both relevant posts reach the outbox/delivery target.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/monitor-multi-account.test.ts`

Expected: FAIL because the monitor only processes `config.username`.

- [ ] **Step 3: Implement minimal sequential collection**

Loop through `config.usernames`, use the corresponding account state, attach the source handle through each post URL, update only that account, and persist after each account. Keep shared version-based deduplication and outbox semantics.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- tests/monitor-multi-account.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing partial-failure test**

Make the first account succeed and the second fail; assert the first cursor is saved, the second cursor is unchanged, pending delivery drains, and the run reports a collection error naming only the failed handle without including secrets.

- [ ] **Step 6: Run RED, implement failure aggregation, then verify GREEN**

Run before and after implementation: `npm test -- tests/monitor-multi-account.test.ts`

Expected before: FAIL on saved progress/error attribution. Expected after: PASS.

- [ ] **Step 7: Run the complete test suite and commit**

Run: `npm test`

Expected: PASS with zero failed tests.

Commit: `feat: monitor reset signals across accounts`

---

### Task 4: Deployment configuration, security checks, and live-safe validation

**Files:**
- Modify: `.github/workflows/monitor.yml`
- Modify: `monitor.env.example`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `package-lock.json` only if a non-breaking audited dependency update is necessary

**Interfaces:**
- Consumes: repository variable `X_USERNAMES`, optional `MATCH_PHRASES`, and Telegram repository secrets.
- Produces: repeatable GitHub Actions deployment instructions and an offline dry-run path.

- [ ] **Step 1: Update deployment configuration and documentation**

Set the workflow default `X_USERNAMES` to the six approved handles, expose optional `MATCH_PHRASES`, document BotFather/chat-ID setup, explain bootstrap silence, and state that FxEmbed is unofficial and X native notifications remain the fallback.

- [ ] **Step 2: Scan for secret exposure**

Run: `rg -n "(TELEGRAM_BOT_TOKEN|X_BEARER_TOKEN|TWILIO_AUTH_TOKEN|RESEND_API_KEY)\s*=\s*[^$\s]" -g '!node_modules' -g '!.git' .`

Expected: no committed real secret values.

- [ ] **Step 3: Run dependency and static verification**

Run: `npm audit --audit-level=high`

Expected: zero high or critical vulnerabilities.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Run full tests and production build**

Run: `npm test`

Expected: zero failed tests.

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 5: Run an offline fixture validation**

Run the monitor tests that exercise bootstrap, phrase detection, multi-account cursors, and Telegram rendering without real network delivery.

Expected: all selected tests pass and no notification token is required.

- [ ] **Step 6: Commit deployment readiness**

Commit: `docs: prepare free reset monitor deployment`

- [ ] **Step 7: Create the user-owned GitHub repository and configure deployment**

Push the verified branch, initialize `monitor-state`, set repository variables, then add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_IDS` as GitHub Actions secrets. Manually run the monitor workflow once and verify that the bootstrap state advances without sending historical alerts.

This step pauses only if the GitHub connection or Telegram values are unavailable; no secret is requested in chat or written to disk.
