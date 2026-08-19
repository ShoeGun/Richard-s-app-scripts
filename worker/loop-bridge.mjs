import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTelemetry } from "./lib/telemetry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "loop.config.json");
const BRIDGE_STATE_PATH = path.join(ROOT, "LOOPS", "loop-bridge-state.json");
const argv = new Set(process.argv.slice(2));

async function main() {
  if (argv.has("--status")) return printStatus();
  if (argv.has("--once")) return syncOnce({ forceComment: true });
  if (argv.has("--loop")) return loop();
  console.log("Usage: node worker/loop-bridge.mjs --status|--once|--loop");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadConfig() {
  return readJson(CONFIG_PATH, {
    syncPaperclip: false,
    syncIntervalSeconds: 300,
    commentCooldownSeconds: 900,
    maxCommentChars: 5000,
    agenticWorklogPath: "LOOPS/edgeops-worker-loop.md",
    statePath: "LOOPS/edgeops-worker-loop.json"
  });
}

function execText(command, args = [], timeoutMs = 30000) {
  let file = command;
  let finalArgs = args;
  if (process.platform === "win32" && command === "paperclipai") {
    file = "cmd.exe";
    finalArgs = ["/d", "/s", "/c", quoteCmd([command, ...args])];
  }
  return new Promise((resolve, reject) => {
    execFile(file, finalArgs, { cwd: ROOT, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (error) {
        error.output = output;
        reject(error);
      } else {
        resolve(output);
      }
    });
  });
}

function quoteCmd(parts) {
  return parts.map((part) => {
    const value = String(part);
    if (!/[\s"&<>|^]/.test(value)) return value;
    return `"${value.replaceAll('"', '\\"')}"`;
  }).join(" ");
}

function sanitize(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/token\s*=\s*["'][^"']+["']/gi, "token = [REDACTED]")
    .replace(/api[_-]?key\s*[:=]\s*["']?[^"'\s]+/gi, "api_key=[REDACTED]")
    .replace(/[A-Za-z0-9_/-]{20,}\.[A-Za-z0-9_/-]{20,}\.[A-Za-z0-9_/-]{20,}/g, "[REDACTED_JWT]")
    .replace(/0\/[A-Za-z0-9_-]{12,}/g, "0/[REDACTED]")
    .slice(0, 12000);
}

async function extractTasks() {
  const markdown = await fs.readFile(path.join(ROOT, "TASKS.md"), "utf8");
  const match = markdown.match(/```worker-task-queue\s*([\s\S]*?)```/);
  return match ? JSON.parse(match[1]) : [];
}

function taskStatus(workerState, taskId) {
  return workerState.taskStates?.[taskId]?.status || "pending";
}

function summarizeEscalationConfig(workerConfig, workerState) {
  const escalation = workerConfig.escalation || {};
  const channels = new Map();
  for (const channel of escalation.frontierChannels || []) channels.set(channel.id, channel);
  for (const channel of escalation.localChannels || []) channels.set(channel.id, channel);
  for (const channel of escalation.channels || []) channels.set(channel.id, channel);
  const ladder = (escalation.ladder || []).map((id) => {
    const channel = channels.get(id);
    return {
      id,
      type: channel?.type || null,
      model: channel?.model || null,
      enabled: channel?.enabled !== false,
      autoInvoke: channel?.autoInvoke === true,
      reasoningEffort: channel?.reasoningEffort || null
    };
  });
  const active = Object.entries(workerState.taskStates || {})
    .filter(([, taskState]) => taskState.status === "awaiting_escalation")
    .map(([taskId, taskState]) => ({
      taskId,
      channel: taskState.escalationChannel || null,
      ladderIndex: taskState.escalationLadderIndex ?? null,
      autoInvoke: taskState.escalationAutoInvoke === true,
      requestPath: taskState.escalationRequestPath || null
    }));
  return {
    enabled: escalation.enabled === true,
    ladder,
    active
  };
}

async function collectSnapshot() {
  const config = await loadConfig();
  const workerState = await readJson(path.join(ROOT, "WORKER_STATE.json"), {});
  const workerConfig = await readJson(path.join(ROOT, "worker", "config.json"), {});
  const bridgeState = await readJson(BRIDGE_STATE_PATH, {});
  const telemetry = await readTelemetry(path.join(ROOT, "worker", "runtime"), 5000);
  const tasks = await extractTasks().catch(() => []);
  const gitStatus = await execText("git", ["status", "--short"], 30000).catch((error) => error.output || error.message);
  const gitLog = await execText("git", ["log", "--oneline", "-6"], 30000).catch((error) => error.output || error.message);
  const blockers = existsSync(path.join(ROOT, "BLOCKERS.md"))
    ? sanitize(await fs.readFile(path.join(ROOT, "BLOCKERS.md"), "utf8"))
    : "";

  const taskCounts = tasks.reduce((acc, task) => {
    const status = taskStatus(workerState, task.id);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const completedTasks = taskCounts.completed || 0;
  const frontierTokens = telemetry.events
    .filter((event) => event.provider === "codex")
    .reduce((sum, event) => sum + (event.usage?.totalTokens || 0), 0);
  const taskTokens = telemetry.events.reduce((totals, event) => {
    if (event.taskId) totals[event.taskId] = (totals[event.taskId] || 0) + (event.usage?.totalTokens || 0);
    return totals;
  }, {});

  const blocked = tasks
    .filter((task) => taskStatus(workerState, task.id) === "blocked")
    .map((task) => ({
      id: task.id,
      title: task.title,
      lastError: sanitize(workerState.taskStates?.[task.id]?.lastError || "")
    }));

  const awaitingEscalation = tasks
    .filter((task) => taskStatus(workerState, task.id) === "awaiting_escalation")
    .map((task) => ({
      id: task.id,
      title: task.title,
      requestPath: workerState.taskStates?.[task.id]?.escalationRequestPath || null,
      channel: workerState.taskStates?.[task.id]?.escalationChannel || null,
      lastError: sanitize(workerState.taskStates?.[task.id]?.lastError || "")
    }));

  const running = tasks
    .filter((task) => taskStatus(workerState, task.id) === "running")
    .map((task) => ({ id: task.id, title: task.title }));

  const nextReady = tasks.find((task) => {
    const status = taskStatus(workerState, task.id);
    if (["completed", "blocked", "running"].includes(status)) return false;
    return (task.dependsOn || []).every((dep) => taskStatus(workerState, dep) === "completed");
  });
  const items = tasks.map((task) => {
    const taskState = workerState.taskStates?.[task.id] || {};
    return {
      id: task.id,
      title: task.title,
      objective: sanitize(task.objective || ""),
      dependsOn: task.dependsOn || [],
      status: taskStatus(workerState, task.id),
      attempts: taskState.attempts || 0,
      repairCycles: taskState.repairCycles || 0,
      escalationChannel: taskState.escalationChannel || null,
      tokens: taskTokens[task.id] || 0,
      lastError: sanitize(taskState.lastError || "")
    };
  });

  const promptQualityFindings = [];
  if ([...blocked, ...awaitingEscalation].some((task) => /See attached|Add your|keep existing|placeholder/i.test(task.lastError))) {
    promptQualityFindings.push("Model produced placeholder edits instead of full-file content.");
  }
  if (gitStatus.includes("package.json") && ["blocked", "awaiting_escalation"].includes(workerState.taskStates?.T001?.status)) {
    promptQualityFindings.push("Repository has uncommitted failed worker edits from blocked T001.");
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    project: ROOT,
    branch: (await execText("git", ["branch", "--show-current"]).catch(() => "")).trim(),
    paperclip: {
      companyId: config.companyId,
      projectId: config.projectId,
      goalId: config.goalId,
      issueId: bridgeState.paperclipIssueId || null
    },
    goal: {
      title: "Browser-native local AI analytics portfolio",
      objective: "Showcase a browser-hosted local language model that proposes validated analytics plans for bundled, public, and visitor-supplied data while remaining static and GitHub Pages compatible.",
      completedTasks,
      totalTasks: tasks.length,
      progressPercent: tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0,
      totalTokens: telemetry.summary?.totals?.totalTokens || 0,
      frontierTokens
    },
    worker: {
      status: workerState.status || "unknown",
      currentTaskId: workerState.currentTaskId || null,
      lastHeartbeat: workerState.lastHeartbeat || null,
      lastError: sanitize(workerState.lastError || ""),
      primaryModel: workerState.primaryModel,
      fallbackModel: workerState.fallbackModel,
      contextTokens: workerState.contextTokens
    },
    tasks: {
      counts: taskCounts,
      items,
      running,
      blocked,
      awaitingEscalation,
      nextReady: nextReady ? { id: nextReady.id, title: nextReady.title } : null
    },
    loopEngineering: {
      escalation: summarizeEscalationConfig(workerConfig, workerState),
      promptQualityFindings,
      nextImprovement: promptQualityFindings.length
        ? "Tighten worker edit contract and recover blocked T001 before resuming dependent tasks."
        : "Observe next worker iteration and compare validation pass/fail evidence."
    },
    git: {
      status: sanitize(gitStatus),
      recentCommits: sanitize(gitLog)
    },
    blockers
  };
}

function fingerprint(snapshot) {
  return JSON.stringify({
    worker: snapshot.worker,
    counts: snapshot.tasks.counts,
    blocked: snapshot.tasks.blocked.map((task) => [task.id, task.lastError.slice(0, 400)]),
    awaitingEscalation: snapshot.tasks.awaitingEscalation.map((task) => [task.id, task.requestPath, task.lastError.slice(0, 400)]),
    escalation: snapshot.loopEngineering.escalation,
    git: snapshot.git.status
  });
}

function renderMarkdown(snapshot) {
  const blockedLines = snapshot.tasks.blocked.length
    ? snapshot.tasks.blocked.map((task) => `- ${task.id}: ${task.title}\n  - ${task.lastError.split("\n")[0].slice(0, 240)}`).join("\n")
    : "- None";
  const awaitingLines = snapshot.tasks.awaitingEscalation.length
    ? snapshot.tasks.awaitingEscalation.map((task) => `- ${task.id}: ${task.title}\n  - Channel: ${task.channel || "manual"}\n  - Request: \`${task.requestPath || "not written"}\``).join("\n")
    : "- None";
  const ladderLines = snapshot.loopEngineering.escalation?.ladder?.length
    ? snapshot.loopEngineering.escalation.ladder.map((channel, index) => `- ${index + 1}. ${channel.id} (${channel.model || channel.type || "manual"}) auto=${channel.autoInvoke ? "yes" : "no"} effort=${channel.reasoningEffort || "n/a"}`).join("\n")
    : "- No escalation ladder configured.";

  return `# EdgeOps Qwen Worker Loop

Last capture: ${snapshot.capturedAt}

## Control Surface

- Project: \`${snapshot.project}\`
- Branch: \`${snapshot.branch}\`
- Paperclip project: \`${snapshot.paperclip.projectId || "not configured"}\`
- Paperclip issue: \`${snapshot.paperclip.issueId || "not synced yet"}\`
- Primary model: \`${snapshot.worker.primaryModel || "unknown"}\`
- Fallback model: \`${snapshot.worker.fallbackModel || "unknown"}\`

## Loop State

- Worker status: \`${snapshot.worker.status}\`
- Current task: \`${snapshot.worker.currentTaskId || "none"}\`
- Last heartbeat: \`${snapshot.worker.lastHeartbeat || "none"}\`
- Last error: ${snapshot.worker.lastError || "none"}

Task counts:

\`\`\`json
${JSON.stringify(snapshot.tasks.counts, null, 2)}
\`\`\`

Next ready task:

\`\`\`json
${JSON.stringify(snapshot.tasks.nextReady, null, 2)}
\`\`\`

## Blocked Tasks

${blockedLines}

## Awaiting Escalation

${awaitingLines}

## Escalation Ladder

${ladderLines}

## Loop Engineering Findings

${snapshot.loopEngineering.promptQualityFindings.map((item) => `- ${item}`).join("\n") || "- No prompt-contract findings in the latest snapshot."}

Next improvement: ${snapshot.loopEngineering.nextImprovement}

## Git Evidence

\`\`\`text
${snapshot.git.status || "(clean)"}
${snapshot.git.recentCommits}
\`\`\`

## Sanitized Blocker Log

\`\`\`text
${snapshot.blockers || "(empty)"}
\`\`\`
`;
}

async function paperclipRequest(config, method, apiPath, body = null) {
  const res = await fetch(`${config.paperclipApiBase || "http://127.0.0.1:3100"}${apiPath}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw new Error(`Paperclip ${method} ${apiPath} failed with ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function ensurePaperclipIssue(config, bridgeState) {
  if (!config.syncPaperclip) return bridgeState.paperclipIssueId || null;
  if (bridgeState.paperclipIssueId) return bridgeState.paperclipIssueId;

  const existingResponse = await paperclipRequest(config, "GET", `/api/companies/${config.companyId}/issues`);
  const existing = Array.isArray(existingResponse) ? existingResponse : existingResponse.value || [];
  const match = existing.find((issue) => issue.title === config.loopTitle);
  if (match) return match.id;

  const description = [
    "Control issue for the local EdgeOps Qwen autonomous worker loop.",
    "",
    "The loop bridge syncs compact state from WORKER_STATE.json, TASKS.md, BLOCKERS.md, and Git evidence.",
    "Use this issue to inspect blocked iterations, prompt-contract failures, task flow, and local-model improvement opportunities.",
    "",
    "Do not paste secrets or raw model logs here."
  ].join("\n");

  const created = await paperclipRequest(config, "POST", `/api/companies/${config.companyId}/issues`, {
    projectId: config.projectId,
    goalId: config.goalId,
    title: config.loopTitle,
    description,
    status: "todo",
    priority: "high",
    workMode: "standard"
  });
  return created.id;
}

function paperclipTaskStatus(status) {
  if (status === "completed") return "done";
  // Project-local workers are not Paperclip agents, and Paperclip requires an
  // assignee for in_progress issues. Keep the projection unassigned and let the
  // description/dashboard carry the live execution state.
  if (status === "running") return "todo";
  if (status === "blocked" || status === "awaiting_escalation") return "blocked";
  return "todo";
}

function taskIssueDescription(task, snapshot) {
  const dependencies = task.dependsOn.length ? task.dependsOn.join(", ") : "none";
  const error = task.lastError ? `\nLast error: ${task.lastError.split("\n")[0].slice(0, 500)}` : "";
  return [
    `Execution projection for ${task.id} in the local EdgeOps worker.`,
    "",
    task.objective,
    "",
    `Local status: ${task.status}`,
    `Dependencies: ${dependencies}`,
    `Attempts: ${task.attempts}; repair cycles: ${task.repairCycles}`,
    `Observed tokens: ${task.tokens || 0}`,
    `Escalation channel: ${task.escalationChannel || "none"}`,
    `Dashboard: http://127.0.0.1:3210`,
    `Repository ledger: ${snapshot.project}\\TASKS.md`,
    error,
    "",
    "This issue is synchronized from the local execution ledger. Edit the operator plan and guardrails in the EdgeOps dashboard."
  ].filter(Boolean).join("\n");
}

function paperclipGoalDescription(snapshot) {
  return [
    "Coordinate bounded, reviewable local-first agent work while minimizing paid foundational-model usage.",
    "",
    "Current primary loop",
    `- Goal: ${snapshot.goal.title}`,
    `- Outcome: ${snapshot.goal.objective}`,
    `- Progress: ${snapshot.goal.completedTasks}/${snapshot.goal.totalTasks} tasks (${snapshot.goal.progressPercent}%)`,
    `- Observed inference: ${snapshot.goal.totalTokens} tokens`,
    `- Observed GPT/Codex share: ${snapshot.goal.frontierTokens} tokens`,
    `- Worker status: ${snapshot.worker.status}`,
    `- Next task: ${snapshot.tasks.nextReady ? `${snapshot.tasks.nextReady.id} ${snapshot.tasks.nextReady.title}` : "none"}`,
    "",
    "Detailed traces, provider usage, model conclusions, and manual GPT approvals are available in Agentic OS."
  ].join("\n");
}

async function syncPaperclipTaskIssues(snapshot, config, bridgeState, parentIssueId) {
  if (!config.syncTaskIssues) return bridgeState;
  bridgeState.taskIssueIds ||= {};
  bridgeState.taskFingerprints ||= {};

  const existingResponse = await paperclipRequest(config, "GET", `/api/companies/${config.companyId}/issues`);
  const existing = Array.isArray(existingResponse) ? existingResponse : existingResponse.value || [];

  for (const task of snapshot.tasks.items || []) {
    const title = `[${task.id}] ${task.title}`;
    let issueId = bridgeState.taskIssueIds[task.id];
    if (!issueId) {
      const match = existing.find((issue) => issue.title === title);
      if (match) {
        issueId = match.id;
      } else {
        const created = await paperclipRequest(config, "POST", `/api/companies/${config.companyId}/issues`, {
          projectId: config.projectId,
          goalId: config.goalId,
          parentId: parentIssueId,
          title,
          description: taskIssueDescription(task, snapshot),
          status: paperclipTaskStatus(task.status),
          priority: task.status === "running" || task.status === "blocked" ? "high" : "medium",
          workMode: "standard"
        });
        issueId = created.id;
      }
      bridgeState.taskIssueIds[task.id] = issueId;
    }

    const fp = JSON.stringify({
      status: task.status,
      attempts: task.attempts,
      repairCycles: task.repairCycles,
      escalationChannel: task.escalationChannel,
      lastError: task.lastError.slice(0, 500)
    });
    if (bridgeState.taskFingerprints[task.id] === fp) continue;
    await paperclipRequest(config, "PATCH", `/api/issues/${issueId}`, {
      status: paperclipTaskStatus(task.status),
      description: taskIssueDescription(task, snapshot),
      priority: task.status === "running" || task.status === "blocked" ? "high" : "medium"
    });
    bridgeState.taskFingerprints[task.id] = fp;
  }
  return bridgeState;
}

async function maybeSyncPaperclip(snapshot, config, bridgeState, fp, forceComment) {
  if (!config.syncPaperclip) return bridgeState;
  const issueId = await ensurePaperclipIssue(config, bridgeState);
  if (!issueId) return bridgeState;
  if (config.goalId) {
    await paperclipRequest(config, "PATCH", `/api/goals/${config.goalId}`, {
      description: paperclipGoalDescription(snapshot)
    }).catch(() => {});
  }

  const now = Date.now();
  const cooldownMs = (config.commentCooldownSeconds || 900) * 1000;
  const shouldComment = forceComment || bridgeState.lastFingerprint !== fp || !bridgeState.lastPaperclipCommentAt || now - Date.parse(bridgeState.lastPaperclipCommentAt) > cooldownMs;

  const status = snapshot.tasks.blocked.length || snapshot.tasks.awaitingEscalation.length ? "blocked" : "todo";
  const ladder = snapshot.loopEngineering.escalation?.ladder?.map((channel) => channel.id).join(" -> ") || "not configured";
  const description = `Control issue for the local EdgeOps Qwen worker loop.\n\nLatest state: ${snapshot.worker.status}\nTask counts: ${JSON.stringify(snapshot.tasks.counts)}\nEscalation ladder: ${ladder}\nLocal ledger: ${snapshot.project}\\LOOPS\\edgeops-worker-loop.md\n\nNo pushes or deployments are performed by this bridge.`;
  await paperclipRequest(config, "PATCH", `/api/issues/${issueId}`, { status, description }).catch(() => {});
  await syncPaperclipTaskIssues(snapshot, config, bridgeState, issueId);

  if (shouldComment) {
    const body = renderMarkdown(snapshot).slice(0, config.maxCommentChars || 5000);
    await paperclipRequest(config, "POST", `/api/issues/${issueId}/comments`, { body }).catch(() => {});
    bridgeState.lastPaperclipCommentAt = new Date().toISOString();
  }

  bridgeState.paperclipIssueId = issueId;
  return bridgeState;
}

async function syncOnce({ forceComment = false } = {}) {
  const config = await loadConfig();
  const bridgeState = await readJson(BRIDGE_STATE_PATH, {});
  const snapshot = await collectSnapshot();
  const fp = fingerprint(snapshot);

  snapshot.paperclip.issueId = bridgeState.paperclipIssueId || null;
  await writeJson(path.join(ROOT, config.statePath), snapshot);
  await fs.writeFile(path.join(ROOT, config.agenticWorklogPath), renderMarkdown(snapshot), "utf8");

  const updatedBridgeState = await maybeSyncPaperclip(snapshot, config, bridgeState, fp, forceComment);
  updatedBridgeState.lastFingerprint = fp;
  updatedBridgeState.lastSyncedAt = new Date().toISOString();
  await writeJson(BRIDGE_STATE_PATH, updatedBridgeState);

  console.log(JSON.stringify({
    ok: true,
    status: snapshot.worker.status,
    taskCounts: snapshot.tasks.counts,
    paperclipIssueId: updatedBridgeState.paperclipIssueId || null,
    ledger: path.join(ROOT, config.agenticWorklogPath)
  }, null, 2));
}

async function printStatus() {
  const config = await loadConfig();
  const bridgeState = await readJson(BRIDGE_STATE_PATH, {});
  const snapshot = await readJson(path.join(ROOT, config.statePath), null);
  console.log(JSON.stringify({
    bridge: bridgeState,
    latestSnapshot: snapshot && {
      capturedAt: snapshot.capturedAt,
      worker: snapshot.worker,
      taskCounts: snapshot.tasks?.counts,
      paperclip: snapshot.paperclip
    }
  }, null, 2));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop() {
  const config = await loadConfig();
  while (true) {
    await syncOnce().catch((error) => {
      console.error(error);
    });
    await sleep((config.syncIntervalSeconds || 300) * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
