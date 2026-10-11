const BUILT_IN_PATTERNS = [
  /\b(?:codex\s+)?(?:(?:usage|rate)\s+)?limits?\s+(?:(?:has|have)\s+been\s+|(?:is|are|was|were)\s+)?(?:reset|refreshed|increased|raised|doubled)\b/iu,
  /\b(?:reset|refreshed|increased|raised|doubled)\s+(?:the\s+)?(?:codex\s+)?(?:(?:usage|rate)\s+)?limits?\b/iu,
  /\b(?:added?|adding|provide[ds]?)\s+(?:even\s+)?(?:more|additional)\s+(?:codex\s+)?capacity\b/iu,
  /\b(?:more|additional)\s+codex\s+capacity\b/iu,
  /(?:codex|openai).{0,24}(?:额度|配额).{0,12}(?:重置|刷新|提高|增加|翻倍)/iu,
  /(?:额度|配额).{0,12}(?:重置|刷新|提高|增加|翻倍).{0,24}(?:codex|openai)/iu,
];

function containsLiteral(text: string, phrase: string): boolean {
  const normalized = phrase.trim().toLocaleLowerCase();
  return normalized.length > 0 && text.toLocaleLowerCase().includes(normalized);
}

export function matchesResetSignal(text: string, phrases: string[]): boolean {
  return (
    phrases.some((phrase) => containsLiteral(text, phrase)) ||
    BUILT_IN_PATTERNS.some((pattern) => pattern.test(text))
  );
}
