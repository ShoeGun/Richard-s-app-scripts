import fs from "node:fs/promises";
import path from "node:path";

function estimateTokens(chars) {
  return Math.max(0, Math.ceil(Number(chars || 0) / 4));
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

export function normalizeUsage({ promptTokens, completionTokens, inputChars, outputChars, exact = false } = {}) {
  const normalizedPrompt = Number.isFinite(promptTokens) ? promptTokens : estimateTokens(inputChars);
  const normalizedCompletion = Number.isFinite(completionTokens) ? completionTokens : estimateTokens(outputChars);
  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: normalizedPrompt + normalizedCompletion,
    exact: exact && Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
  };
}

export async function recordInference(runtimeDir, event) {
  const capturedAt = new Date().toISOString();
  const usage = normalizeUsage(event.usage);
  const normalized = {
    id: `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    capturedAt,
    provider: event.provider || "unknown",
    model: event.model || "unknown",
    agent: event.agent || "worker",
    phase: event.phase || "unknown",
    taskId: event.taskId || null,
    durationMs: Math.max(0, Number(event.durationMs || 0)),
    status: event.status || "ok",
    usage
  };

  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.appendFile(path.join(runtimeDir, "inference-events.jsonl"), `${JSON.stringify(normalized)}\n`, "utf8");

  const summaryPath = path.join(runtimeDir, "telemetry-summary.json");
  const summary = await readJson(summaryPath, {
    version: 1,
    updatedAt: null,
    totals: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 },
    models: {},
    agents: {}
  });

  const add = (target) => {
    target.calls = (target.calls || 0) + 1;
    target.promptTokens = (target.promptTokens || 0) + usage.promptTokens;
    target.completionTokens = (target.completionTokens || 0) + usage.completionTokens;
    target.totalTokens = (target.totalTokens || 0) + usage.totalTokens;
    target.durationMs = (target.durationMs || 0) + normalized.durationMs;
    target.exactCalls = (target.exactCalls || 0) + (usage.exact ? 1 : 0);
    target.estimatedCalls = (target.estimatedCalls || 0) + (usage.exact ? 0 : 1);
    target.lastUsedAt = capturedAt;
  };

  add(summary.totals);
  summary.models[normalized.model] ||= {};
  summary.agents[normalized.agent] ||= {};
  add(summary.models[normalized.model]);
  add(summary.agents[normalized.agent]);
  summary.updatedAt = capturedAt;
  await writeJsonAtomic(summaryPath, summary);
  return normalized;
}

export async function readTelemetry(runtimeDir, eventLimit = 120) {
  const summary = await readJson(path.join(runtimeDir, "telemetry-summary.json"), null);
  let events;
  try {
    const lines = (await fs.readFile(path.join(runtimeDir, "inference-events.jsonl"), "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-eventLimit);
    events = lines.map((line) => JSON.parse(line)).reverse();
  } catch {
    events = [];
  }
  return { summary, events };
}
