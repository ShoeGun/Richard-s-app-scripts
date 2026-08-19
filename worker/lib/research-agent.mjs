const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 5;

function cleanText(value, limit = 240) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function buildResearchQuery(task = {}, taskState = {}) {
  const source = [task.title, task.objective, taskState.lastError]
    .map((value) => cleanText(value, 500))
    .filter(Boolean)
    .join(" ");
  return cleanText(source
    .replace(/[A-Za-z]:\\[^\s`]+/gi, " ")
    .replace(/\\Users\\[^\s`]+/gi, " ")
    .replace(/https?:\/\/[^\s`]+/gi, " "), 220);
}

export function parseDuckDuckGoResults(html, maxResults = DEFAULT_MAX_RESULTS) {
  const results = [];
  const source = String(html || "");
  const pattern = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(source)) && results.length < Math.max(1, maxResults)) {
    const url = decodeHtml(match[1]);
    const title = cleanText(decodeHtml(match[2]).replace(/<[^>]+>/g, ""), 300);
    if (!/^https?:\/\//i.test(url) || !title) continue;
    results.push({ title, url: cleanText(url, 1000) });
  }
  return results;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export async function collectWebResearch({ task, taskState, config = {} }) {
  const policy = config.escalation?.preApprovalResearch?.webSearch || {};
  const query = buildResearchQuery(task, taskState);
  if (policy.enabled === false || !query) return { query, results: [], skipped: true };

  const timeoutMs = Math.max(1000, Number(policy.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxResults = Math.min(8, Math.max(1, Number(policy.maxResults || DEFAULT_MAX_RESULTS)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "EdgeOps-local-research/1.0" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Web research returned HTTP ${response.status}.`);
    const results = parseDuckDuckGoResults(await response.text(), maxResults);
    return { query, results };
  } catch (error) {
    return {
      query,
      results: [],
      error: String(error?.message || error).slice(0, 500)
    };
  } finally {
    clearTimeout(timer);
  }
}
