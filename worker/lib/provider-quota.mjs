function finiteLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function eventMatches(event, channel) {
  if ((event.provider || "unknown") !== channel.telemetryProvider) return false;
  if (channel.quotaScope === "provider") return true;
  return (event.model || "unknown") === (channel.telemetryModel || channel.model);
}

export function providerQuotaUsage(events, channel, now = Date.now()) {
  const minuteStart = now - 60 * 1000;
  const dayStart = now - 24 * 60 * 60 * 1000;
  const usage = {
    requestsMinute: 0,
    requestsDay: 0,
    tokensMinute: 0,
    tokensDay: 0
  };

  for (const event of events || []) {
    if (!eventMatches(event, channel)) continue;
    const capturedAt = Date.parse(event.capturedAt);
    if (!Number.isFinite(capturedAt) || capturedAt < dayStart) continue;
    const tokens = Math.max(0, Number(event.usage?.totalTokens || 0));
    usage.requestsDay += 1;
    usage.tokensDay += tokens;
    if (capturedAt >= minuteStart) {
      usage.requestsMinute += 1;
      usage.tokensMinute += tokens;
    }
  }
  return usage;
}

export function assertProviderQuota({ events, channel, inputTokens = 0, now = Date.now() }) {
  const usage = providerQuotaUsage(events, channel, now);
  const checks = [
    ["requestsPerMinute", usage.requestsMinute, 1, "requests/minute"],
    ["requestsPerDay", usage.requestsDay, 1, "requests/day"],
    ["tokensPerMinute", usage.tokensMinute, inputTokens, "tokens/minute"],
    ["tokensPerDay", usage.tokensDay, inputTokens, "tokens/day"]
  ];

  for (const [field, used, pending, label] of checks) {
    const limit = finiteLimit(channel[field]);
    if (limit && used + pending > limit) {
      const error = new Error(
        `${channel.id} quota exhausted: ${used} used + ${pending} pending exceeds ${limit} ${label}.`
      );
      error.code = "PROVIDER_QUOTA_EXHAUSTED";
      error.quota = { field, used, pending, limit };
      throw error;
    }
  }

  const maxInputTokens = finiteLimit(channel.maxInputTokens);
  if (maxInputTokens && inputTokens > maxInputTokens) {
    const error = new Error(
      `${channel.id} input is too large: ${inputTokens} estimated tokens exceeds ${maxInputTokens}.`
    );
    error.code = "PROVIDER_INPUT_TOO_LARGE";
    error.quota = { field: "maxInputTokens", used: 0, pending: inputTokens, limit: maxInputTokens };
    throw error;
  }
  return usage;
}
