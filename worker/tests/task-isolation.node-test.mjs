import assert from "node:assert/strict";
import test from "node:test";

import {
  baselineValidationCommands,
  canConsumeEscalationAnswer,
  effectiveEscalationGuidance,
  recordWorkspaceBaselineFailure,
  selectOperatorPlan,
  taskIdsInPlan
} from "../lib/task-isolation.mjs";

test("deduplicates baseline checks and supports an explicit opt-out", () => {
  const task = { validation: ["npm run typecheck", "npm run typecheck", "npm test"] };
  assert.deepEqual(
    baselineValidationCommands(task),
    ["npm run typecheck", "npm test"]
  );
  assert.deepEqual(
    baselineValidationCommands(task, { validateWorkspaceBeforeInference: false }),
    []
  );
});

test("classifies baseline failure without charging or blocking the task", () => {
  const state = {
    status: "idle",
    currentTaskId: null,
    lastError: null,
    taskStates: {
      T006: { status: "pending", attempts: 4, repairCycles: 1 }
    }
  };

  recordWorkspaceBaselineFailure(
    state,
    { id: "T006" },
    { command: "npm run typecheck", code: 2 }
  );

  assert.equal(state.status, "workspace_invalid");
  assert.match(state.lastError, /no model call was made/i);
  assert.equal(state.taskStates.T006.status, "pending");
  assert.equal(state.taskStates.T006.attempts, 4);
  assert.equal(state.taskStates.T006.repairCycles, 1);
  assert.match(state.taskStates.T006.workspaceBlockedReason, /typecheck/);
});

test("extracts stable task ids from an operator plan", () => {
  assert.deepEqual(
    taskIdsInPlan("Complete T003B, then review t007. Do not repeat T003B."),
    ["T003B", "T007"]
  );
});

test("does not inject a global plan into a different named task", () => {
  assert.deepEqual(
    selectOperatorPlan({
      taskId: "T007",
      activePlan: "# Goal\nComplete T003B only."
    }),
    {
      plan: "",
      source: "none",
      scope: ["T003B"],
      skippedReason: "PLANS/ACTIVE_PLAN.md is scoped to T003B, not T007."
    }
  );
});

test("task-specific plan overrides the global active plan", () => {
  assert.deepEqual(
    selectOperatorPlan({
      taskId: "T007",
      activePlan: "Complete T003B only.",
      taskPlan: "Implement T007 using its completed dependencies."
    }),
    {
      plan: "Implement T007 using its completed dependencies.",
      source: "PLANS/TASKS/T007.md",
      scope: ["T007"],
      skippedReason: null
    }
  );
});

test("an unscoped active plan remains available to every task", () => {
  const selected = selectOperatorPlan({
    taskId: "T008",
    activePlan: "Use the existing design system and run all tests."
  });
  assert.equal(selected.plan, "Use the existing design system and run all tests.");
  assert.equal(selected.source, "PLANS/ACTIVE_PLAN.md");
  assert.deepEqual(selected.scope, []);
});

test("accepts late escalation guidance for a requeued pending task", () => {
  assert.equal(canConsumeEscalationAnswer("pending"), true);
  assert.equal(canConsumeEscalationAnswer("awaiting_escalation"), true);
  assert.equal(canConsumeEscalationAnswer("blocked"), true);
  assert.equal(canConsumeEscalationAnswer("running"), false);
  assert.equal(canConsumeEscalationAnswer("completed"), false);
});

test("injects an operator resolution without replaying stale diagnosis details", () => {
  const answer = `# Escalation Answer

## Operator Resolution

The routing defect is fixed. Proceed with T007 using its task-specific plan.

## Diagnosis

Do not implement T007 because a stale T003B plan was present.`;
  assert.equal(
    effectiveEscalationGuidance(answer),
    "## Operator Resolution\n\nThe routing defect is fixed. Proceed with T007 using its task-specific plan."
  );
});

test("preserves a normal escalation answer when no operator resolution exists", () => {
  assert.equal(
    effectiveEscalationGuidance("Use the existing Zod schema and add three boundary tests."),
    "Use the existing Zod schema and add three boundary tests."
  );
});
