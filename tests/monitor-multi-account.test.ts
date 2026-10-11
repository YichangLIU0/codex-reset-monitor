import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { runMonitor } from "../src/monitor";
import { emptyState, writeState } from "../src/state";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "reset-multi-account-"));
  directories.push(directory);
  const config = loadConfig({
    X_USERNAMES: "sama,gdb",
    STATE_PATH: join(directory, "state.json"),
  });
  const state = emptyState(config.usernames, config.keyword);
  state.accounts.sama.sinceId = "1";
  state.accounts.gdb.sinceId = "1";
  await writeState(config.statePath, state);
  return { config };
}

function resetPost(username: string, id: string) {
  return {
    id,
    text: `We have reset Codex usage limits for @${username}.`,
    createdAt: "2026-10-11T12:00:00Z",
    url: `https://x.com/${username}/status/${id}`,
    media: [],
  };
}

describe("multi-account monitoring", () => {
  it("keeps independent cursors and delivers matches from both accounts", async () => {
    const { config } = await setup();
    const source = {
      resolveUserId: vi.fn(async (username: string) => `${username}-id`),
      getPosts: vi.fn(async ({ username }: { username: string }) => {
        const id = username === "sama" ? "20" : "30";
        return { posts: [resetPost(username, id)], newestId: id };
      }),
    };
    const send = vi.fn().mockResolvedValue(undefined);

    const state = await runMonitor(config, {
      source,
      targets: [{ id: "telegram:test", channel: "telegram", send }],
    });

    expect(state.accounts.sama.sinceId).toBe("20");
    expect(state.accounts.gdb.sinceId).toBe("30");
    expect(source.resolveUserId).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("persists successful accounts when a later account fails", async () => {
    const { config } = await setup();
    const source = {
      resolveUserId: vi.fn(async (username: string) => `${username}-id`),
      getPosts: vi.fn(async ({ username }: { username: string }) => {
        if (username === "gdb") throw new Error("secret=must-not-leak");
        return { posts: [resetPost(username, "20")], newestId: "20" };
      }),
    };
    const send = vi.fn().mockResolvedValue(undefined);

    await expect(
      runMonitor(config, {
        source,
        targets: [{ id: "telegram:test", channel: "telegram", send }],
      }),
    ).rejects.toThrow("@gdb collection failed");

    const saved = JSON.parse(await readFile(config.statePath, "utf8"));
    expect(saved.accounts.sama.sinceId).toBe("20");
    expect(saved.accounts.gdb.sinceId).toBe("1");
    expect(JSON.stringify(saved)).not.toContain("must-not-leak");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
