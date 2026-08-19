import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFailure,
  initialEscalationIndex,
  profileTaskDifficulty,
  trajectoryPolicy
} from "../lib/task-routing.mjs";

test("profiles cross-module integration work as complex", () => {
  const profile = profileTaskDifficulty({
    title: "Browser model integration",
    objective: "Connect WebGPU model output to a DuckDB worker",
    dependsOn: ["T005", "T006"],
    focus: ["src", "public", "README.md", "package.json"],
    acceptance: ["loads", "validates", "executes", "handles errors"]
  });
  assert.equal(profile.level, "complex");
  assert.ok(profile.reasons.length >= 3);
});

test("distinguishes runtime and proposal failures from reasoning failures", () => {
  assert.equal(classifyFailure("Ollama transport failed: The operation was aborted"), "runtime");
  assert.equal(classifyFailure("Replacement 1 expected exactly once but found 0"), "proposal_protocol");
  assert.equal(classifyFailure("Validation failed: npm run typecheck"), "validation");
  assert.equal(classifyFailure("The algorithm selected an unsupported operation"), "reasoning");
});

test("starts protocol recovery at a strong structured-output route", () => {
  const ladder = [
    { id: "qwen3.5-fast-local" },
    { id: "hermes-ollama-local" },
    { id: "groq-gpt-oss-120b" },
    { id: "gpt-5.4" }
  ];
  assert.equal(initialEscalationIndex(ladder, { failureClass: "proposal_protocol" }), 2);
  assert.equal(initialEscalationIndex(ladder, { failureClass: "validation" }), 1);
});

test("uses bounded trajectory defaults", () => {
  assert.deepEqual(trajectoryPolicy({}, { trajectoryAttempts: 1, runtimeRetries: 2 }), {
    maxLocalAttempts: 2,
    maxPostGuidanceAttempts: 1,
    maxRuntimeRetries: 2,
    attempts: 1,
    runtimeRetries: 2
  });
});
