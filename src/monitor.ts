import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AccountState, AppConfig, MatchRecord, MonitorState, XPost } from "./types";
import { extractEvents } from "./events";
import { containsKeyword } from "./matcher";
import { matchesResetSignal } from "./signal-matcher";
import { createTargets, type NotificationTarget } from "./notifications";
import { readState, writeState } from "./state";
import { createPostSource, type PostSource } from "./post-source";
import {
  buildPublicStatus,
  writePublicFeed,
  writePublicStatus,
} from "./public-status";

const EVENT_PARSER_VERSION = 5;

type Dependencies = {
  source?: PostSource;
  /** @deprecated Use source. Kept for existing integrations. */
  xClient?: PostSource;
  targets?: NotificationTarget[];
  now?: () => Date;
};

export const postVersion = (post: XPost) =>
  createHash("sha256")
    .update(JSON.stringify([post.canonicalId ?? post.id, post.text, post.createdAt, post.media]))
    .digest("hex");

async function persist(config: AppConfig, state: MonitorState, now: () => Date): Promise<void> {
  await writeState(config.statePath, state);
  if (config.publicStatusPath) {
    const status = buildPublicStatus(
      state,
      config.sourceProvider,
      now().toISOString(),
    );
    await writePublicStatus(config.publicStatusPath, status);
    await writePublicFeed(join(dirname(config.publicStatusPath), "feed.xml"), status);
  }
}

function detectedRecord(
  post: XPost,
  version: string,
  events: MatchRecord["events"],
  detectedAt: string,
): MatchRecord {
  return { version, ...post, detectedAt, events, channels: [] };
}

function eventsForPost(post: XPost, config: AppConfig): MatchRecord["events"] {
  if (config.keyword.toLowerCase() === "reset") {
    const username = new URL(post.url).pathname.split("/")[1]?.toLowerCase();
    if (username === "thsottiaux") {
      const canonicalEvents = extractEvents(post, config.sourceTimezone).filter(
        (event) => config.includeMentions || event.type !== "mention",
      );
      if (canonicalEvents.length) return canonicalEvents;
    }
    if (!matchesResetSignal(post.text, config.matchPhrases)) return [];
    return [{
      type: "reset",
      status: "announced",
      evidence: post.text,
      time: {
        kind: "unknown",
        start: null,
        end: null,
        evidence: post.text,
      },
    }];
  }
  return containsKeyword(post.text, config.keyword)
    ? [
        {
          type: "mention" as const,
          status: "uncertain" as const,
          evidence: post.text,
          time: {
            kind: "unknown" as const,
            start: null,
            end: null,
            evidence: post.text,
          },
        },
      ]
    : [];
}

function newestPost(posts: XPost[]): XPost | null {
  return posts.reduce<XPost | null>(
    (latest, post) => !latest || BigInt(post.id) > BigInt(latest.id) ? post : latest,
    null,
  );
}

function updateLatestObservedPost(state: AccountState, post: XPost | null): void {
  if (!post) return;
  if (
    !state.latestObservedPost ||
    BigInt(post.id) >= BigInt(state.latestObservedPost.id)
  )
    state.latestObservedPost = post;
}

function reprojectSavedMatches(state: MonitorState, config: AppConfig): void {
  if (state.eventParserVersion === EVENT_PARSER_VERSION) return;
  state.matches = state.matches
    .map((match) => {
      const post: XPost = {
        id: match.id,
        text: match.text,
        createdAt: match.createdAt,
        url: match.url,
        media: match.media,
      };
      return { ...match, events: eventsForPost(post, config) };
    })
    .filter((match) => match.events.length > 0);
  // Pending notifications intentionally keep the event payload captured when they
  // entered the outbox. Parser migrations update public projections only and never
  // create or resend historical deliveries.
  state.eventParserVersion = EVENT_PARSER_VERSION;
}

export async function runMonitor(config: AppConfig, deps: Dependencies = {}): Promise<MonitorState> {
  await mkdir(dirname(config.statePath), { recursive: true });
  const lockPath = `${config.statePath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("Monitor state is locked; stop any active worker before removing a stale .lock file");
    throw error;
  }
  try {
    return await runLocked(config, deps);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function runLocked(config: AppConfig, deps: Dependencies): Promise<MonitorState> {
  const state = await readState(config.statePath, config.usernames, config.keyword);
  const client = deps.source ?? deps.xClient ?? createPostSource(config);
  const targets = deps.targets ?? createTargets(config);
  if (!targets.length) throw new Error("No notification targets configured");
  const now = deps.now ?? (() => new Date());
  state.version = 3;
  state.username = config.username;
  state.usernames = [...config.usernames];
  state.outbox ??= [];
  state.seen ??= {};
  const parserChanged = state.eventParserVersion !== EVENT_PARSER_VERSION;
  reprojectSavedMatches(state, config);
  if (parserChanged && state.matches.length) await persist(config, state, now);
  const errors: string[] = [];
  let successfulAccounts = 0;

  for (const username of config.usernames) {
    const account = state.accounts[username.toLowerCase()];
    const bootstrap = account.sinceId === null;
    let fetched: Awaited<ReturnType<PostSource["getPosts"]>>;
    try {
      account.userId ??= await client.resolveUserId(username);
      fetched = await client.getPosts({
        userId: account.userId,
        username,
        sinceId: account.sinceId,
        excludeReplies: config.excludeReplies,
        bootstrap,
      });
    } catch {
      account.lastRunStatus = "collection-failed";
      errors.push(`@${username} collection failed; cursor not advanced`);
      continue;
    }

    const { posts, newestId } = fetched;
    updateLatestObservedPost(
      account,
      fetched.latestObservedPost ?? newestPost(posts),
    );

    for (const post of [...posts].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
      const identity = post.canonicalId ?? post.id;
      const version = postVersion(post);
      if (state.seen[identity] === version) continue;
      state.seen[identity] = version;
      const events = eventsForPost(post, config);

      if (events.length) {
        if (!state.matches.some((match) => match.version === version)) {
          state.matches = [
            detectedRecord(post, version, events, now().toISOString()),
            ...state.matches,
          ].slice(0, 20);
        }
        // Bootstrap still detects recent signals for the dashboard, but historical
        // notifications remain opt-in to prevent a noisy first deployment.
        if (
          (!bootstrap || config.bootstrapNotify) &&
          !state.outbox.some((item) => item.key === version)
        ) {
          state.outbox.push({
            key: version,
            post,
            events,
            targets: targets.map((target) => target.id),
            delivered: [],
          });
        }
      }
    }

    account.sinceId =
      newestId && (!account.sinceId || BigInt(newestId) > BigInt(account.sinceId))
        ? newestId
        : account.sinceId;
    account.postsScanned += posts.length;
    const checkedAt = now().toISOString();
    account.lastCheckedAt = checkedAt;
    account.lastSuccessAt = checkedAt;
    account.lastRunStatus = bootstrap ? "bootstrapped" : `checked-${posts.length}-posts`;
    successfulAccounts += 1;
    await persist(config, state, now);
  }

  for (const item of [...state.outbox]) {
    for (const targetId of item.targets) {
      if (item.delivered.includes(targetId)) continue;
      const target = targets.find((candidate) => candidate.id === targetId);
      if (!target) {
        errors.push(
          "Pending target is no longer configured; restore its configuration or explicitly remove its pending delivery",
        );
        continue;
      }
      try {
        await target.send(item);
      } catch {
        errors.push(`${target.channel} delivery failed; will retry on next run`);
        continue;
      }
      item.delivered.push(targetId);
      const match = state.matches.find((candidate) => candidate.version === item.key);
      if (match) {
        match.channels = item.delivered
          .map((id) => targets.find((candidate) => candidate.id === id)?.channel)
          .filter((channel): channel is string => Boolean(channel));
        match.notifiedAt ??= now().toISOString();
      }
      await persist(config, state, now);
    }
    if (item.targets.every((id) => item.delivered.includes(id))) {
      state.outbox = state.outbox.filter((pending) => pending.key !== item.key);
      await persist(config, state, now);
    }
  }

  state.seen = Object.fromEntries(Object.entries(state.seen).slice(-2000));
  state.lastRunStatus = errors.length
    ? `degraded-${successfulAccounts}-of-${config.usernames.length}-accounts`
    : `checked-${successfulAccounts}-accounts`;
  await persist(config, state, now);
  if (errors.length) throw new Error([...new Set(errors)].join("; "));
  return state;
}
