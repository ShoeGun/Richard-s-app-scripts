function parseCandidate(candidate) {
  const value = String(candidate || "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    return JSON.parse(value.slice(start, end + 1));
  }
}

export function extractJsonObject(text) {
  const original = String(text || "").trim();
  const withoutThinking = original.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidates = [fenced, withoutThinking, original].filter(Boolean);
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = parseCandidate(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("Model response did not contain a JSON object.");
}
