import crypto from "node:crypto";

export function normalizeFailureForFingerprint(errorText) {
  return String(errorText || "")
    .replace(/[A-Z]:\\[^\s"'`]+/gi, "<path>")
    .replace(/\/[^\s"'`]+/g, "<path>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[^\s"'`]+/g, "<time>")
    .replace(/\b\d+:\d+\b/g, "<line>")
    .replace(/\b\d{3,}\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function failureFingerprint(errorText) {
  const normalized = normalizeFailureForFingerprint(errorText);
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function recordFailureFingerprint(taskState, errorText, now = new Date().toISOString()) {
  const fingerprint = failureFingerprint(errorText);
  if (!fingerprint) return { fingerprint: null, count: 0 };
  taskState.failureFingerprints = taskState.failureFingerprints && typeof taskState.failureFingerprints === "object"
    ? taskState.failureFingerprints
    : {};
  const entry = taskState.failureFingerprints[fingerprint] || { count: 0, firstSeenAt: now };
  entry.count += 1;
  entry.lastSeenAt = now;
  entry.sample = normalizeFailureForFingerprint(errorText).slice(0, 800);
  taskState.failureFingerprints[fingerprint] = entry;
  taskState.lastFailureFingerprint = fingerprint;
  taskState.lastFailureFingerprintCount = entry.count;
  return { fingerprint, count: entry.count };
}

export function isFrontierChannel(channel) {
  if (channel?.type === "codex") return true;
  if (channel?.type && channel.type !== "manual") return false;
  return /^gpt-5[._-](?:4|6)(?:$|[._-])/i.test(channel?.model || "")
    || /^gpt-5[._-](?:4|6)(?:$|[._-])/i.test(channel?.id || "");
}

export function frontierUsage(events, taskId, since = null) {
  const minTime = since ? Date.parse(since) : null;
  return (events || []).reduce((usage, event) => {
    if (!isFrontierChannel({ type: event.provider, model: event.model, id: event.agent })) return usage;
    if (minTime && Date.parse(event.capturedAt || 0) < minTime) return usage;
    usage.totalCalls += 1;
    usage.totalTokens += event.usage?.totalTokens || 0;
    if (event.taskId === taskId) {
      usage.taskCalls += 1;
      usage.taskTokens += event.usage?.totalTokens || 0;
    }
    return usage;
  }, { totalCalls: 0, totalTokens: 0, taskCalls: 0, taskTokens: 0 });
}

export function assertFrontierBudget({
  channel,
  promptChars,
  taskId,
  telemetry,
  config,
  now = new Date(),
  manualOverride = false
}) {
  if (!isFrontierChannel(channel)) return;
  const budget = config.escalation?.frontierBudget || {};
  if (budget.enabled === false) return;
  const day = now.toISOString().slice(0, 10);
  const since = `${day}T00:00:00.000Z`;
  const usage = frontierUsage(telemetry?.events || [], taskId, since);
  const maxPromptChars = budget.maxPromptChars || channel.maxPromptChars || 14000;
  const maxCallsPerTask = budget.maxCallsPerTask ?? 1;
  const maxCallsPerDay = budget.maxCallsPerDay ?? 2;

  if (promptChars > maxPromptChars) {
    throw new Error(`Frontier request is ${promptChars} chars; budget allows ${maxPromptChars}. Compact the escalation packet first.`);
  }
  if (manualOverride) return;
  if (usage.taskCalls >= maxCallsPerTask) {
    throw new Error(`Frontier budget exhausted for ${taskId}: ${usage.taskCalls}/${maxCallsPerTask} calls already used today.`);
  }
  if (usage.totalCalls >= maxCallsPerDay) {
    throw new Error(`Daily frontier budget exhausted: ${usage.totalCalls}/${maxCallsPerDay} calls already used today.`);
  }
}

export function compactText(text, maxChars, label = "content") {
  const value = String(text || "");
  if (!maxChars || value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.62);
  const tail = Math.max(0, maxChars - head - 140);
  return `${value.slice(0, head)}

[... ${label} compacted: ${value.length - head - tail} chars omitted ...]

${value.slice(-tail)}`;
}

export function buildFrontierPrompt(request, {
  maxChars = 14000,
  maxAnswerWords = 900
} = {}) {
  const suffix = `

You are a frontier escalation agent for a local-first autonomous software loop.

Rules:
- Produce final guidance only. Do not directly edit files.
- Prefer concise, implementation-oriented instructions over broad design prose.
- Use the evidence in the request first. Read extra files only if absolutely necessary.
- Keep the answer under ${maxAnswerWords} words.
- Do not include secrets, tokens, raw logs, or unrelated repository content.
`;
  if (suffix.length >= maxChars) {
    throw new Error(`Frontier prompt wrapper exceeds the ${maxChars}-character budget.`);
  }
  return `${compactText(request, maxChars - suffix.length, "frontier request")}${suffix}`;
}

export function findEscalationChannel(channels, channelId, { allowDisabledExact = false } = {}) {
  if (!channelId) return null;
  const normalized = {
    "chatgpt-5.4-manual": "gpt-5.4",
    "chatgpt-5.6-manual": "gpt-5.6"
  }[channelId] || channelId;
  const exact = (channels || []).find((channel) =>
    channel?.id === normalized && (allowDisabledExact || channel.enabled !== false)
  );
  if (exact) return exact;
  return (channels || []).find((channel) =>
    channel?.enabled !== false
    && (
      (channel.aliases || []).includes(channelId)
      || (channel.aliases || []).includes(normalized)
    )
  ) || null;
}

function providerFamily(channel) {
  return channel?.telemetryProvider || channel?.provider || channel?.type || null;
}

export function nextChannelAfterFailure(ladder, failedIndex, errorText) {
  const failed = ladder[failedIndex];
  if (!failed) return { channel: null, index: ladder.length, providerWide: false };
  const providerWide = failed.quotaScope === "provider"
    || failed.type === "antigravity"
    || failed.type === "copilot-cli";
  const exhausted = providerWide
    && /\b(429|quota|rate.?limit|usage.?limit|allowance|capacity)\b/i.test(String(errorText || ""));
  const family = providerFamily(failed);
  let index = failedIndex + 1;
  const skippedChannelIds = [];
  if (exhausted) {
    while (index < ladder.length && providerFamily(ladder[index]) === family) {
      skippedChannelIds.push(ladder[index].id);
      index += 1;
    }
  }
  return { channel: ladder[index] || null, index, providerWide: exhausted, skippedChannelIds };
}
