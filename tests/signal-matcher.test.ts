import { describe, expect, it } from "vitest";
import { matchesResetSignal } from "../src/signal-matcher";

describe("reset and capacity signal matching", () => {
  it.each([
    "We have reset Codex usage limits across all plans.",
    "Your rate limit has been reset.",
    "Codex limits have been doubled for the weekend.",
    "We added more Codex capacity today.",
    "Codex 额度重置已经完成。",
    "本周 Codex 配额提高。",
  ])("matches a credible signal: %s", (text) => {
    expect(matchesResetSignal(text, [])).toBe(true);
  });

  it.each([
    "My credit card limit changed.",
    "The movie credits reset the mood.",
    "There are limits to every benchmark.",
  ])("rejects unrelated wording: %s", (text) => {
    expect(matchesResetSignal(text, [])).toBe(false);
  });

  it("supports literal custom phrases", () => {
    expect(matchesResetSignal("Codex turbo weekend begins", ["turbo weekend"])).toBe(
      true,
    );
    expect(matchesResetSignal("Codex turbo-weekend begins", ["turbo weekend"])).toBe(
      false,
    );
  });
});
