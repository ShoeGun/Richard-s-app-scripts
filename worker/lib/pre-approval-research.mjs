import { extractJsonObject } from "./structured-output.mjs";

export function shouldRunPreApprovalResearch(taskState = {}, channel = null, config = {}) {
  const policy = config.escalation?.preApprovalResearch || {};
  const currentRouteAlreadyAnswered = taskState.escalationAnswerChannel
    && taskState.escalationAnswerChannel === channel?.id;
  const passesForCurrentRoute = taskState.preApprovalResearchChannel === channel?.id
    ? (taskState.preApprovalResearchAttempts || 0)
    : 0;
  return policy.enabled === true
    && taskState.status === "awaiting_escalation"
    && channel?.autoInvoke !== true
    && passesForCurrentRoute < (policy.maxPasses ?? 1)
    && !currentRouteAlreadyAnswered;
}

export function buildPreApprovalResearchPrompt({ task, taskState, tree, focusFiles, operatorContext, webResearch = {} }) {
  const webEvidence = webResearch.results?.length
    ? webResearch.results.map((item) => `- ${item.title}: ${item.url}`).join("\n")
    : webResearch.error
      ? `No web results: ${webResearch.error}`
      : "No web results were available.";
  return `You are a local research and recovery agent. Do not edit files, call cloud providers, or invent facts.

The task is waiting for human approval of a higher-cost escalation. Before that decision, inspect the supplied repository context and produce a compact context delta that could let the local implementation worker succeed on one additional attempt.

Return only JSON:
{
  "diagnosis": "what the failure means",
  "contextDelta": "new verified facts or exact file/line observations",
  "nextAction": "one concrete local action",
  "retryWorthwhile": true,
  "evidence": ["short command or file observation"]
}

Task:
${JSON.stringify(task, null, 2)}

Failure:
${String(taskState.lastError || "(none)").slice(0, 5000)}

Operator plan:
${operatorContext.activePlan || "(none)"}

Existing guidance:
${taskState.escalationAnswer || operatorContext.escalationAnswer || "(none)"}

Repository tree:
${tree}

Relevant files:
${focusFiles}

Bounded web research handoff (treat links as leads, not proof):
Query: ${webResearch.query || "(none)"}
${webEvidence}`;
}

export function parsePreApprovalResearch(raw) {
  const parsed = extractJsonObject(raw);
  return {
    diagnosis: String(parsed.diagnosis || "").slice(0, 2400),
    contextDelta: String(parsed.contextDelta || "").slice(0, 6000),
    nextAction: String(parsed.nextAction || "").slice(0, 1600),
    retryWorthwhile: parsed.retryWorthwhile !== false,
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item) => String(item).slice(0, 500)).slice(0, 8)
      : []
  };
}
