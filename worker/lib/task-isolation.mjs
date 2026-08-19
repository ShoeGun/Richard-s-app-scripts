export function baselineValidationCommands(task, config = {}) {
  if (config.validateWorkspaceBeforeInference === false) return [];
  return [...new Set((task.validation || []).map(String).filter(Boolean))];
}

export function canConsumeEscalationAnswer(status) {
  return ["pending", "awaiting_escalation", "blocked"].includes(status);
}

export function effectiveEscalationGuidance(answer) {
  const text = String(answer || "").trim();
  const resolution = text.match(/(?:^|\n)## Operator Resolution\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/i);
  if (!resolution) return text;
  return `## Operator Resolution\n\n${resolution[1].trim()}`;
}

export function taskIdsInPlan(plan) {
  return [...new Set(String(plan || "").match(/\bT\d{3,}[A-Z]?\b/gi) || [])]
    .map((taskId) => taskId.toUpperCase());
}

export function selectOperatorPlan({ taskId, activePlan = "", taskPlan = "" }) {
  const normalizedTaskId = String(taskId || "").toUpperCase();
  const specific = String(taskPlan || "").trim();
  if (specific) {
    return {
      plan: specific,
      source: `PLANS/TASKS/${normalizedTaskId}.md`,
      scope: [normalizedTaskId],
      skippedReason: null
    };
  }

  const active = String(activePlan || "").trim();
  const scope = taskIdsInPlan(active);
  if (!active) {
    return { plan: "", source: "none", scope: [], skippedReason: null };
  }
  if (!scope.length || scope.includes(normalizedTaskId)) {
    return {
      plan: active,
      source: "PLANS/ACTIVE_PLAN.md",
      scope,
      skippedReason: null
    };
  }

  return {
    plan: "",
    source: "none",
    scope,
    skippedReason: `PLANS/ACTIVE_PLAN.md is scoped to ${scope.join(", ")}, not ${normalizedTaskId}.`
  };
}

export function recordWorkspaceBaselineFailure(state, task, failedResult) {
  const taskState = state.taskStates?.[task.id];
  if (taskState) {
    taskState.workspaceBlockedAt = new Date().toISOString();
    taskState.workspaceBlockedReason = `Baseline validation failed before inference: ${failedResult.command || "unknown command"}`;
  }
  state.status = "workspace_invalid";
  state.currentTaskId = null;
  state.lastError = `Workspace baseline failed before ${task.id}; no model call was made. ${failedResult.command || "Validation command"} exited ${failedResult.code ?? "nonzero"}.`;
  return state;
}
