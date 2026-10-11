import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, readState } from "../src/state";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "reset-state-v3-"));
  directories.push(directory);
  return join(directory, "state.json");
}

describe("multi-account monitor state", () => {
  it("creates an independent cursor entry for every configured account", () => {
    const state = emptyState(["sama", "gdb"], "reset");
    expect(state.version).toBe(3);
    expect(Object.keys(state.accounts)).toEqual(["sama", "gdb"]);
    expect(state.accounts.sama.sinceId).toBeNull();
    expect(state.accounts.gdb.sinceId).toBeNull();
    state.accounts.sama.sinceId = "20";
    expect(state.accounts.gdb.sinceId).toBeNull();
  });

  it("migrates a v2 cursor into its matching account", async () => {
    const path = await statePath();
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        username: "thsottiaux",
        keyword: "reset",
        userId: "42",
        sinceId: "100",
        lastCheckedAt: "2026-09-09T03:00:00Z",
        lastSuccessAt: "2026-09-09T03:00:00Z",
        lastRunStatus: "checked-1-posts",
        postsScanned: 5,
        matches: [],
        outbox: [],
        seen: {},
        latestObservedPost: null,
      }),
      "utf8",
    );

    const state = await readState(path, ["thsottiaux", "sama"], "reset");
    expect(state.version).toBe(3);
    expect(state.accounts.thsottiaux).toMatchObject({
      userId: "42",
      sinceId: "100",
      postsScanned: 5,
    });
    expect(state.accounts.sama.sinceId).toBeNull();
  });

  it("adds newly configured accounts without invalidating saved progress", async () => {
    const path = await statePath();
    const first = emptyState(["sama"], "reset");
    first.accounts.sama.sinceId = "200";
    await writeFile(path, `${JSON.stringify(first)}\n`, "utf8");

    const expanded = await readState(path, ["sama", "gdb"], "reset");
    expect(expanded.accounts.sama.sinceId).toBe("200");
    expect(expanded.accounts.gdb.sinceId).toBeNull();
    expect(expanded.usernames).toEqual(["sama", "gdb"]);
  });
});
