/** OpenRouter may report a dated OpenAI or Gemini snapshot for a stable alias.
 * This is metadata identity only, never permission to switch model families or
 * attach billing from a different generation ID. Other providers match exactly. */
export function matchesGenerationModel(actual: string, expected: string) {
  if (actual === expected) return true;
  if ((!expected.startsWith("openai/") && !expected.startsWith("google/gemini-")) || !actual.startsWith(`${expected}-`)) return false;
  const suffix = actual.slice(expected.length + 1);
  if (!/^20\d{6}$/.test(suffix) && !/^20\d{2}-\d{2}-\d{2}$/.test(suffix)) return false;
  const date = suffix.replaceAll("-", "");
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}
