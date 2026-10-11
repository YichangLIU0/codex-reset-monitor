import { describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "../src/config";

describe("monitored account configuration", () => {
  it("normalizes and deduplicates X_USERNAMES case-insensitively", () => {
    const config = loadConfig({ X_USERNAMES: "@sama, gdb, SAMA" });
    expect(config.usernames).toEqual(["sama", "gdb"]);
    expect(config.username).toBe("sama");
  });

  it("keeps X_USERNAME as a backwards-compatible fallback", () => {
    const config = loadConfig({ X_USERNAME: "@OpenAI" });
    expect(config.usernames).toEqual(["OpenAI"]);
  });

  it("defaults to the approved reset-monitor account list", () => {
    const config = loadConfig({});
    expect(config.usernames).toEqual([
      "thsottiaux",
      "sama",
      "gdb",
      "OpenAI",
      "OpenAIDevs",
      "dkundel",
    ]);
  });

  it("rejects an explicitly empty list and invalid handles", () => {
    expect(() => loadConfig({ X_USERNAMES: " , " })).toThrow(
      "X_USERNAMES must contain at least one X handle",
    );
    const config = loadConfig({ X_USERNAMES: "valid,bad-handle" });
    expect(validateConfig(config, { offline: true })).toContain(
      "X_USERNAMES contains an invalid X handle: bad-handle.",
    );
  });
});

describe("source timezone defaults", () => {
  it("defaults @thsottiaux announcements to America/Los_Angeles", () => {
    const config = loadConfig({});
    expect(config.username).toBe("thsottiaux");
    expect(config.sourceTimezone).toBe("America/Los_Angeles");
  });

  it("does not impose the Tibo timezone on other monitored accounts", () => {
    const config = loadConfig({ X_USERNAME: "someone_else" });
    expect(config.sourceTimezone).toBeUndefined();
  });

  it("lets SOURCE_TIMEZONE override the canonical default", () => {
    const config = loadConfig({
      X_USERNAME: "thsottiaux",
      SOURCE_TIMEZONE: "Europe/London",
    });
    expect(config.sourceTimezone).toBe("Europe/London");
  });
});
