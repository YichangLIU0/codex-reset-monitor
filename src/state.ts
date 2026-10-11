import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AccountState, MatchRecord, MonitorState, XPost } from "./types";

function accountKey(username: string): string {
  return username.toLowerCase();
}

export function emptyAccountState(username: string): AccountState {
  return {
    username,
    userId: null,
    sinceId: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastRunStatus: "waiting-for-first-run",
    postsScanned: 0,
    latestObservedPost: null,
  };
}

export function emptyState(usernames: string[] | string, keyword: string): MonitorState {
  const configured = typeof usernames === "string" ? [usernames] : usernames;
  return {
    version: 3,
    username: configured[0],
    usernames: [...configured],
    keyword,
    accounts: Object.fromEntries(
      configured.map((username) => [accountKey(username), emptyAccountState(username)]),
    ),
    lastRunStatus: "waiting-for-first-run",
    matches: [],
    outbox: [],
    seen: {},
  };
}

function migrateMatch(match: Record<string, unknown>): MatchRecord {
  const id = String(match.id ?? "");
  const createdAt = typeof match.createdAt === "string" ? match.createdAt : null;
  const notifiedAt =
    typeof match.notifiedAt === "string" ? match.notifiedAt : undefined;
  return {
    version:
      typeof match.version === "string"
        ? match.version
        : `legacy:${id}:${createdAt ?? "unknown"}`,
    id,
    text: String(match.text ?? ""),
    createdAt,
    url: String(match.url ?? ""),
    media: Array.isArray(match.media) ? (match.media as MatchRecord["media"]) : [],
    detectedAt:
      typeof match.detectedAt === "string"
        ? match.detectedAt
        : notifiedAt ?? createdAt ?? new Date(0).toISOString(),
    events: Array.isArray(match.events)
      ? (match.events as MatchRecord["events"])
      : [],
    notifiedAt,
    channels: Array.isArray(match.channels)
      ? match.channels.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function migrateObservedPost(value: unknown): XPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    !/^\d+$/.test(raw.id) ||
    typeof raw.text !== "string" ||
    typeof raw.url !== "string" ||
    !(raw.createdAt === null || typeof raw.createdAt === "string")
  )
    return null;
  return {
    id: raw.id,
    canonicalId: typeof raw.canonicalId === "string" ? raw.canonicalId : undefined,
    text: raw.text,
    createdAt: raw.createdAt as string | null,
    url: raw.url,
    media: Array.isArray(raw.media) ? (raw.media as XPost["media"]) : [],
  };
}

export async function readState(
  path: string,
  usernames: string[] | string,
  keyword: string,
): Promise<MonitorState> {
  const configured = typeof usernames === "string" ? [usernames] : usernames;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (raw.keyword !== keyword)
      throw new Error("State belongs to a different keyword; use a new STATE_PATH");
    if (!Array.isArray(raw.matches))
      throw new Error("Invalid monitor state; restore a known-good backup");
    if (raw.version !== undefined && raw.version !== 2 && raw.version !== 3)
      throw new Error("Unsupported state version");

    const state = raw.version === 3
      ? (raw as unknown as MonitorState)
      : migrateV2State(raw, configured, keyword);
    state.version = 3;
    state.username = configured[0];
    state.usernames = [...configured];
    state.accounts ??= {};
    for (const username of configured) {
      const key = accountKey(username);
      state.accounts[key] ??= emptyAccountState(username);
    }
    for (const account of Object.values(state.accounts)) validateAccount(account);
    state.matches = raw.matches.map((match) =>
      migrateMatch(match as Record<string, unknown>),
    );
    state.outbox = Array.isArray(raw.outbox)
      ? (raw.outbox as MonitorState["outbox"])
      : [];
    state.seen =
      raw.seen && typeof raw.seen === "object"
        ? (raw.seen as Record<string, string>)
        : {};
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState(configured, keyword);
    }
    throw error;
  }
}

function validateAccount(account: AccountState): void {
  if (
    !account ||
    typeof account.username !== "string" ||
    !Number.isFinite(account.postsScanned) ||
    (account.sinceId !== null && !/^\d+$/.test(String(account.sinceId)))
  )
    throw new Error("Invalid monitor state; restore a known-good backup");
  account.latestObservedPost = migrateObservedPost(account.latestObservedPost);
  account.lastSuccessAt =
    typeof account.lastSuccessAt === "string"
      ? account.lastSuccessAt
      : typeof account.lastCheckedAt === "string"
        ? account.lastCheckedAt
        : null;
}

function migrateV2State(
  raw: Record<string, unknown>,
  configured: string[],
  keyword: string,
): MonitorState {
  const legacyUsername = String(raw.username ?? configured[0]);
  const state = emptyState(
    configured.some((username) => accountKey(username) === accountKey(legacyUsername))
      ? configured
      : [legacyUsername, ...configured],
    keyword,
  );
  const legacyAccount = state.accounts[accountKey(legacyUsername)];
  legacyAccount.userId = typeof raw.userId === "string" ? raw.userId : null;
  legacyAccount.sinceId = raw.sinceId == null ? null : String(raw.sinceId);
  legacyAccount.lastCheckedAt =
    typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : null;
  legacyAccount.lastSuccessAt =
    typeof raw.lastSuccessAt === "string"
      ? raw.lastSuccessAt
      : legacyAccount.lastCheckedAt;
  legacyAccount.lastRunStatus =
    typeof raw.lastRunStatus === "string"
      ? raw.lastRunStatus
      : "waiting-for-first-run";
  legacyAccount.postsScanned = Number(raw.postsScanned ?? 0);
  legacyAccount.latestObservedPost = migrateObservedPost(raw.latestObservedPost);
  state.lastRunStatus = legacyAccount.lastRunStatus;
  return state;
}

export async function writeState(
  path: string,
  state: MonitorState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
