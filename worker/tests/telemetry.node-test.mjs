import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizePerformance, normalizeUsage, readTelemetry, recordInference } from "../lib/telemetry.mjs";

test("uses exact provider counts when available", () => {
  assert.deepEqual(normalizeUsage({
    promptTokens: 120,
    completionTokens: 30,
    inputChars: 9999,
    outputChars: 9999,
    exact: true
  }), {
    promptTokens: 120,
    completionTokens: 30,
    totalTokens: 150,
    exact: true
  });
});

test("persists aggregate model and agent usage", async () => {
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "edgeops-telemetry-"));
  try {
    await recordInference(runtimeDir, {
      provider: "ollama",
      model: "qwen:test",
      agent: "implementer",
      phase: "implementation",
      taskId: "T1",
      durationMs: 25,
      usage: { promptTokens: 20, completionTokens: 5, exact: true },
      performance: {
        promptEvalDurationNs: 2_000_000_000,
        evalDurationNs: 500_000_000,
        loadDurationNs: 100_000_000
      }
    });
    const telemetry = await readTelemetry(runtimeDir);
    assert.equal(telemetry.summary.totals.totalTokens, 25);
    assert.equal(telemetry.summary.models["qwen:test"].calls, 1);
    assert.equal(telemetry.summary.agents.implementer.exactCalls, 1);
    assert.equal(telemetry.summary.models["qwen:test"].promptTokensPerSecond, 10);
    assert.equal(telemetry.summary.models["qwen:test"].completionTokensPerSecond, 10);
    assert.equal(telemetry.events[0].taskId, "T1");
  } finally {
    await fs.rm(runtimeDir, { recursive: true, force: true });
  }
});

test("normalizes Ollama nanosecond timing counters", () => {
  assert.deepEqual(normalizePerformance({
    promptTokens: 100,
    completionTokens: 50,
    promptEvalDurationNs: 2_000_000_000,
    evalDurationNs: 1_000_000_000,
    loadDurationNs: 250_000_000
  }), {
    promptEvalDurationMs: 2000,
    evalDurationMs: 1000,
    loadDurationMs: 250,
    promptTokensPerSecond: 50,
    completionTokensPerSecond: 50,
    exact: true
  });
});
