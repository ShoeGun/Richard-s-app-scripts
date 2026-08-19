import assert from "node:assert/strict";
import test from "node:test";

import {
  assertFrontierBudget,
  buildFrontierPrompt,
  frontierUsage,
  failureFingerprint,
  findEscalationChannel,
  nextChannelAfterFailure,
  recordFailureFingerprint
} from "../lib/escalation-policy.mjs";

test("normalizes volatile error details into the same failure fingerprint", () => {
  const first = failureFingerprint("Validation failed at C:\\Users\\Richard\\Projects\\app\\src\\x.ts:120 on 2026-07-23T12:00:00.000Z");
  const second = failureFingerprint("Validation failed at C:\\Users\\Richard\\Projects\\app\\src\\x.ts:211 on 2026-07-23T12:04:10.000Z");
  assert.equal(first, second);
});

test("skips an exhausted provider family but not an ordinary model failure", () => {
  const ladder = [
    { id: "agy-fast", type: "antigravity" },
    { id: "agy-pro", type: "antigravity" },
    { id: "gpt", type: "codex" }
  ];
  assert.deepEqual(
    nextChannelAfterFailure(ladder, 0, "HTTP 429: quota reached"),
    { channel: ladder[2], index: 2, providerWide: true, skippedChannelIds: ["agy-pro"] }
  );
  assert.deepEqual(
    nextChannelAfterFailure(ladder, 0, "invalid response shape"),
    { channel: ladder[1], index: 1, providerWide: false, skippedChannelIds: [] }
  );
});

test("exact frontier channel wins over a legacy manual alias", () => {
  const channels = [
    { id: "chatgpt-5.4-manual", type: "manual", aliases: ["gpt-5.4"] },
    { id: "gpt-5.4", type: "codex", enabled: true }
  ];
  assert.equal(findEscalationChannel(channels, "gpt-5.4")?.type, "codex");
});

test("an explicit approval may select a disabled exact frontier channel", () => {
  const channels = [
    { id: "chatgpt-5.4-manual", type: "manual", aliases: ["gpt-5.4"] },
    { id: "gpt-5.4", type: "codex", enabled: false }
  ];
  assert.equal(
    findEscalationChannel(channels, "gpt-5.4", { allowDisabledExact: true })?.type,
    "codex"
  );
});

test("records repeated failure fingerprints on task state", () => {
  const taskState = {};
  const first = recordFailureFingerprint(taskState, "npm run build failed at src/a.ts:20");
  const second = recordFailureFingerprint(taskState, "npm run build failed at src/a.ts:44");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(second.count, 2);
  assert.equal(taskState.lastFailureFingerprintCount, 2);
});

test("blocks frontier approval when task budget is already spent", () => {
  assert.throws(() => assertFrontierBudget({
    channel: { type: "codex", model: "gpt-5.4", id: "gpt-5.4" },
    promptChars: 1000,
    taskId: "T1",
    config: { escalation: { frontierBudget: { maxPromptChars: 2000, maxCallsPerTask: 1, maxCallsPerDay: 5 } } },
    telemetry: {
      events: [{
        capturedAt: "2026-07-23T10:00:00.000Z",
        provider: "codex",
        model: "gpt-5.4",
        agent: "gpt-5.4",
        taskId: "T1",
        usage: { totalTokens: 500, exact: false }
      }]
    },
    now: new Date("2026-07-23T12:00:00.000Z")
  }), /Frontier budget exhausted for T1/);
});

test("manual frontier approval overrides local call-count budgets", () => {
  assert.doesNotThrow(() => assertFrontierBudget({
    channel: { type: "codex", model: "gpt-5.4", id: "gpt-5.4" },
    promptChars: 1000,
    taskId: "T1",
    config: { escalation: { frontierBudget: { maxPromptChars: 2000, maxCallsPerTask: 1, maxCallsPerDay: 1 } } },
    telemetry: {
      events: [
        {
          capturedAt: "2026-07-23T10:00:00.000Z",
          provider: "codex",
          model: "gpt-5.4",
          agent: "gpt-5.4",
          taskId: "T1",
          usage: { totalTokens: 500, exact: false }
        },
        {
          capturedAt: "2026-07-23T10:10:00.000Z",
          provider: "codex",
          model: "gpt-5.6-sol",
          agent: "gpt-5.6",
          taskId: "T2",
          usage: { totalTokens: 800, exact: false }
        }
      ]
    },
    now: new Date("2026-07-23T12:00:00.000Z"),
    manualOverride: true
  }));
});

test("allows the configured second frontier fallback for the same task", () => {
  assert.doesNotThrow(() => assertFrontierBudget({
    channel: { type: "codex", model: "gpt-5.6-sol", id: "gpt-5.6" },
    promptChars: 1000,
    taskId: "T007",
    config: { escalation: { frontierBudget: { maxPromptChars: 2000, maxCallsPerTask: 2, maxCallsPerDay: 2 } } },
    telemetry: {
      events: [{
        capturedAt: "2026-07-23T10:00:00.000Z",
        provider: "codex",
        model: "gpt-5.4",
        agent: "gpt-5.4",
        taskId: "T007",
        usage: { totalTokens: 500, exact: false }
      }]
    },
    now: new Date("2026-07-23T12:00:00.000Z")
  }));
});

test("frontier compaction reserves room for wrapper instructions", () => {
  const prompt = buildFrontierPrompt("x".repeat(20000), {
    maxChars: 14000,
    maxAnswerWords: 700
  });
  assert.ok(prompt.length <= 14000);
  assert.match(prompt, /frontier request compacted/);
  assert.match(prompt, /Keep the answer under 700 words/);
});

test("free GPT-OSS events do not consume the paid frontier budget", () => {
  const usage = frontierUsage([
    {
      capturedAt: "2026-07-23T10:00:00.000Z",
      provider: "antigravity",
      model: "gpt-oss-120b-medium",
      agent: "antigravity-gpt-oss-120b",
      taskId: "T007",
      usage: { totalTokens: 500 }
    },
    {
      capturedAt: "2026-07-23T11:00:00.000Z",
      provider: "codex",
      model: "gpt-5.4",
      agent: "gpt-5.4",
      taskId: "T007",
      usage: { totalTokens: 500 }
    }
  ], "T007", "2026-07-23T00:00:00.000Z");
  assert.deepEqual(usage, {
    totalCalls: 1,
    totalTokens: 500,
    taskCalls: 1,
    taskTokens: 500
  });
});
