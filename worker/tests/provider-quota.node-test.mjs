import assert from "node:assert/strict";
import test from "node:test";

import { assertProviderQuota, providerQuotaUsage } from "../lib/provider-quota.mjs";

const now = Date.parse("2026-07-24T12:00:00.000Z");
const channel = {
  id: "free-route",
  telemetryProvider: "free-provider",
  telemetryModel: "model-a",
  quotaScope: "provider-model",
  requestsPerMinute: 2,
  requestsPerDay: 3,
  tokensPerMinute: 100,
  tokensPerDay: 500,
  maxInputTokens: 80
};

function event(secondsAgo, totalTokens, model = "model-a", status = "ok") {
  return {
    capturedAt: new Date(now - secondsAgo * 1000).toISOString(),
    provider: "free-provider",
    model,
    status,
    usage: { totalTokens }
  };
}

test("counts successful and failed provider attempts in quota windows", () => {
  const usage = providerQuotaUsage([
    event(10, 30),
    event(20, 20, "model-a", "error"),
    event(90, 40),
    event(10, 999, "model-b")
  ], channel, now);

  assert.deepEqual(usage, {
    requestsMinute: 2,
    requestsDay: 3,
    tokensMinute: 50,
    tokensDay: 90
  });
});

test("supports provider-wide quotas across models", () => {
  const usage = providerQuotaUsage(
    [event(10, 30), event(10, 40, "model-b")],
    { ...channel, quotaScope: "provider" },
    now
  );
  assert.equal(usage.requestsMinute, 2);
  assert.equal(usage.tokensMinute, 70);
});

test("rejects a call before crossing request, token, or input limits", () => {
  assert.throws(
    () => assertProviderQuota({ events: [event(10, 10), event(20, 10)], channel, inputTokens: 1, now }),
    (error) => error.code === "PROVIDER_QUOTA_EXHAUSTED" && error.quota.field === "requestsPerMinute"
  );
  assert.throws(
    () => assertProviderQuota({
      events: [event(10, 95)],
      channel: { ...channel, requestsPerMinute: 5 },
      inputTokens: 6,
      now
    }),
    (error) => error.code === "PROVIDER_QUOTA_EXHAUSTED" && error.quota.field === "tokensPerMinute"
  );
  assert.throws(
    () => assertProviderQuota({ events: [], channel, inputTokens: 81, now }),
    (error) => error.code === "PROVIDER_INPUT_TOO_LARGE"
  );
});
