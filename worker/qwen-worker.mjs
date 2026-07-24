import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { commitPathsForProposal, resolveRepositoryPath, validateProposal } from "./lib/proposal.mjs";
import { recordInference } from "./lib/telemetry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, "WORKER_STATE.json");
const TASKS_PATH = path.join(ROOT, "TASKS.md");
const CONFIG_PATH = path.join(__dirname, "config.json");
const CONTROL_DIR = path.join(ROOT, ".worker-control");
const PAUSE_FILE = path.join(CONTROL_DIR, "paused");
const STOP_FILE = path.join(CONTROL_DIR, "stop");
const LOG_DIR = path.join(__dirname, "logs");
const DETAIL_LOG = path.join(LOG_DIR, "worker-detail.log");
const PLANS_DIR = path.join(ROOT, "PLANS");
const ESCALATIONS_DIR = path.join(ROOT, "ESCALATIONS");
const ESCALATION_OUTBOX = path.join(ESCALATIONS_DIR, "outbox");
const ESCALATION_INBOX = path.join(ESCALATIONS_DIR, "inbox");
const ESCALATION_PROCESSED = path.join(ESCALATIONS_DIR, "processed");
const ESCALATION_LOCAL = path.join(ESCALATIONS_DIR, "local");
const ESCALATION_FRONTIER = path.join(ESCALATIONS_DIR, "frontier");
const RUNTIME_DIR = path.join(__dirname, "runtime");

const argv = new Set(process.argv.slice(2));

async function main() {
  await fs.mkdir(CONTROL_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });

  if (argv.has("--status")) return printStatus();
  if (argv.has("--doctor")) return doctor();
  if (argv.has("--pause")) return setStatus("paused", "Pause requested.");
  if (argv.has("--resume")) return setStatus("idle", null);
  if (argv.has("--stop")) return setStatus("stopped", "Stop requested.");
  if (argv.has("--smoke-edit")) return smokeEdit();
  if (argv.has("--benchmark")) return benchmarkModels();
  if (argv.has("--escalate")) return runLocalEscalation();
  if (argv.has("--once")) return runOnce();
  if (argv.has("--loop")) return runLoop();

  console.log("Usage: node worker/qwen-worker.mjs --doctor|--status|--once|--loop|--smoke-edit|--benchmark|--escalate <TASK_ID> --channel <CHANNEL_ID>");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function loadConfig() {
  return readJson(CONFIG_PATH, {});
}

function defaultState(config = {}) {
  return {
    version: 1,
    status: "idle",
    primaryModel: config.primaryModel || "qwen3:8b",
    fallbackModel: config.fallbackModel || "qwen2.5-coder:7b",
    contextTokens: config.contextTokens || 16384,
    maxRepairCycles: config.maxRepairCycles || 3,
    lastHeartbeat: null,
    currentTaskId: null,
    workerPid: null,
    lastError: null,
    benchmark: null,
    taskStates: {}
  };
}

async function loadState(config = {}) {
  const state = { ...defaultState(config), ...(await readJson(STATE_PATH, {})) };
  state.primaryModel = config.routing?.implementerModel || config.primaryModel || state.primaryModel;
  state.fallbackModel = config.routing?.repairModel || config.fallbackModel || state.fallbackModel;
  return state;
}

async function saveState(state) {
  state.lastHeartbeat = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(tmp, STATE_PATH);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt === 4) {
        await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
        await fs.rm(tmp, { force: true }).catch(() => {});
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function setStatus(status, error) {
  const config = await loadConfig();
  const state = await loadState(config);
  for (const taskState of Object.values(state.taskStates || {})) {
    if (taskState.status !== "running") continue;
    taskState.status = "pending";
    taskState.interruptions = (taskState.interruptions || 0) + 1;
    taskState.lastInterruptedAt = new Date().toISOString();
    taskState.lastError = `Task returned to pending because the worker was ${status}.`;
    delete taskState.lease;
  }
  state.status = status;
  state.currentTaskId = null;
  state.workerPid = process.pid;
  state.lastError = error;
  await saveState(state);
  console.log(`Worker status set to ${status}.`);
}

async function appendFile(filePath, text) {
  await fs.appendFile(filePath, text, "utf8");
}

async function log(message, extra = null) {
  const line = `[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ""}\n`;
  await appendFile(DETAIL_LOG, line);
  await appendFile(path.join(ROOT, "RUN_LOG.md"), `- ${line}`);
}

async function readOptionalText(filePath, maxChars = 30000) {
  try {
    return (await fs.readFile(filePath, "utf8")).slice(0, maxChars);
  } catch {
    return "";
  }
}

function relativeSafePath(inputPath) {
  const { normalized, absolute } = resolveRepositoryPath(ROOT, inputPath);
  const denied = [".git/", ".worker-control/", "node_modules/", "worker/logs/"];
  const lowered = normalized.toLowerCase();
  if (denied.some((prefix) => lowered.startsWith(prefix))) {
    throw new Error(`Path is not editable by worker: ${inputPath}`);
  }
  return { normalized, absolute };
}

async function extractTasks() {
  const markdown = await fs.readFile(TASKS_PATH, "utf8");
  const match = markdown.match(/```worker-task-queue\s*([\s\S]*?)```/);
  if (!match) throw new Error("TASKS.md is missing a worker-task-queue JSON block.");
  return JSON.parse(match[1]);
}

function taskStatus(state, taskId) {
  return state.taskStates[taskId]?.status || "pending";
}

function nextReadyTask(tasks, state) {
  for (const task of tasks) {
    const status = taskStatus(state, task.id);
    if (status === "completed" || status === "blocked" || status === "running" || status === "awaiting_escalation") continue;
    const deps = task.dependsOn || [];
    if (deps.every((dep) => taskStatus(state, dep) === "completed")) return task;
  }
  return null;
}

function allTerminal(tasks, state) {
  return tasks.every((task) => ["completed", "blocked"].includes(taskStatus(state, task.id)));
}

async function listTree() {
  const files = [];
  async function walk(dir, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(prefix, entry.name).replaceAll("\\", "/");
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || rel.startsWith("worker/logs") || rel.startsWith(".worker-control")) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else files.push(rel);
    }
  }
  await walk(ROOT);
  return files.slice(0, 180).join("\n").slice(0, 6000);
}

async function readFocusFiles(task) {
  const files = new Set();
  for (const focus of task.focus || []) {
    const safe = relativeSafePath(focus);
    if (!existsSync(safe.absolute)) continue;
    const stat = await fs.stat(safe.absolute);
    if (stat.isFile()) files.add(safe.normalized);
    if (stat.isDirectory()) {
      const children = await fs.readdir(safe.absolute, { withFileTypes: true });
      for (const child of children.slice(0, 24)) {
        if (child.isFile()) files.add(path.posix.join(safe.normalized, child.name));
      }
    }
  }
  for (const file of [
    "SPEC.md",
    "ARCHITECTURE.md",
    "AGENTS.md",
    "DECISIONS.md",
    "package.json"
  ]) files.add(file);

  const chunks = [];
  let remainingChars = 18000;
  for (const file of files) {
    if (remainingChars <= 0) break;
    try {
      const safe = relativeSafePath(file);
      const stat = await fs.stat(safe.absolute);
      if (stat.size > 50000) continue;
      const content = await fs.readFile(safe.absolute, "utf8");
      const chunk = `--- ${file} ---\n${content.slice(0, Math.min(9000, remainingChars))}`;
      chunks.push(chunk);
      remainingChars -= chunk.length;
    } catch {
      // Ignore unreadable focus files.
    }
  }
  return chunks.join("\n\n");
}

async function gpuBusy(config) {
  for (const lockRel of config.knownGpuLockFiles || []) {
    const absolute = path.resolve(ROOT, lockRel);
    if (existsSync(absolute)) return { busy: true, reason: `lock file exists: ${absolute}` };
  }

  const smi = await execText("nvidia-smi", [], 5000).catch(() => "");
  const lower = smi.toLowerCase();
  for (const pattern of config.gpuDenyProcessPatterns || []) {
    if (lower.includes(String(pattern).toLowerCase())) {
      return { busy: true, reason: `GPU process matched: ${pattern}` };
    }
  }
  return { busy: false, reason: null };
}

function execText(command, args = [], timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: ROOT, timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(`${stdout}${stderr}`);
      }
    });
  });
}

function execWithInput(command, args = [], input = "", timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      stderr += `\nTimed out after ${timeoutMs}ms.`;
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command, args, code: timedOut ? -1 : code, stdout: stdout.slice(-12000), stderr: stderr.slice(-12000) });
    });
    child.stdin.end(input);
  });
}

async function ollamaGenerate(config, model, prompt, timeoutMs = 20 * 60 * 1000, extraOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const telemetry = extraOptions.telemetry || {};
  const options = { ...extraOptions };
  delete options.telemetry;
  const jsonMode = options.jsonMode === true;
  delete options.jsonMode;
  const think = options.think ?? false;
  delete options.think;
  const onProgress = telemetry.onProgress;
  delete telemetry.onProgress;
  try {
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        think,
        ...(jsonMode ? { format: "json" } : {}),
        keep_alive: config.keepAlive || "2m",
        options: {
           num_ctx: config.contextTokens || 16384,
          num_predict: config.maxOutputTokens || 4096,
           temperature: config.temperature ?? 0.15,
          ...options
        }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("Ollama returned no response body.");
    const decoder = new TextDecoder();
    let buffer = "";
    let responseText = "";
    let finalData = {};
    let lastProgressAt = 0;
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (data.error) throw new Error(`Ollama stream error: ${data.error}`);
        responseText += data.response || "";
        if (data.done) finalData = data;
      }
      if (onProgress && Date.now() - lastProgressAt >= 5000) {
        lastProgressAt = Date.now();
        await onProgress({ outputChars: responseText.length });
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = JSON.parse(buffer);
      if (data.error) throw new Error(`Ollama stream error: ${data.error}`);
      responseText += data.response || "";
      if (data.done) finalData = data;
    }
    await recordInference(RUNTIME_DIR, {
      provider: "ollama",
      model,
      agent: telemetry.agent || "local-worker",
      phase: telemetry.phase || "generation",
      taskId: telemetry.taskId || null,
      durationMs: Date.now() - startedAt,
      status: "ok",
      usage: {
        promptTokens: finalData.prompt_eval_count,
        completionTokens: finalData.eval_count,
        inputChars: prompt.length,
        outputChars: responseText.length,
        exact: Number.isFinite(finalData.prompt_eval_count) && Number.isFinite(finalData.eval_count)
      }
    });
    return responseText;
  } catch (error) {
    await recordInference(RUNTIME_DIR, {
      provider: "ollama",
      model,
      agent: telemetry.agent || "local-worker",
      phase: telemetry.phase || "generation",
      taskId: telemetry.taskId || null,
      durationMs: Date.now() - startedAt,
      status: "error",
      usage: { inputChars: prompt.length, outputChars: 0, exact: false }
    }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function unloadModel(config, model) {
  try {
    await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: 0 })
    });
  } catch {
    // Best effort only.
  }
}

function extractJsonObject(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : cleaned;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model response did not contain a JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function assertAllowedCommand(command, config) {
  if (typeof command !== "string") throw new Error("Command must be a string.");
  const trimmed = command.trim();
  if (/[;&|<>`]/.test(trimmed)) throw new Error(`Command uses denied shell metacharacters: ${trimmed}`);
  const allowed = (config.allowedCommandPrefixes || []).some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
  if (!allowed) throw new Error(`Command is not allowlisted: ${trimmed}`);
  return trimmed;
}

function runCommand(command, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nTimed out after ${timeoutMs}ms.`;
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command, code, stdout: stdout.slice(-12000), stderr: stderr.slice(-12000) });
    });
  });
}

async function applyEdits(edits, backupPaths = edits.map((edit) => edit.path)) {
  const backups = [];
  for (const filePath of backupPaths) {
    const safe = relativeSafePath(filePath);
    const existed = existsSync(safe.absolute);
    if (existed && !(await fs.stat(safe.absolute)).isFile()) {
      throw new Error(`Backup path is not a file: ${safe.normalized}`);
    }
    backups.push({
      path: safe.normalized,
      absolute: safe.absolute,
      existed,
      content: existed ? await fs.readFile(safe.absolute, "utf8") : null
    });
  }
  for (const edit of edits) {
    await fs.mkdir(path.dirname(edit.absolute), { recursive: true });
    await fs.writeFile(edit.absolute, edit.content, "utf8");
  }
  return backups;
}

async function restoreEditBackups(backups) {
  for (const backup of [...backups].reverse()) {
    if (backup.existed) {
      await fs.mkdir(path.dirname(backup.absolute), { recursive: true });
      await fs.writeFile(backup.absolute, backup.content, "utf8");
    } else {
      await fs.rm(backup.absolute, { force: true });
    }
  }
}

async function assertEditTargetsClean(paths) {
  if (!paths.length) throw new Error("Proposal has no commit paths.");
  const status = await execText("git", ["status", "--porcelain", "--untracked-files=all", "--", ...paths], 30000);
  if (status.trim()) {
    throw new Error(`Task edit targets already have uncommitted changes:\n${status.trim()}`);
  }
}

async function runValidation(commands, config) {
  const results = [];
  for (const raw of commands || []) {
    const command = assertAllowedCommand(raw, config);
    await log(`Running validation command: ${command}`);
    const result = await runCommand(command);
    results.push(result);
    await appendFile(DETAIL_LOG, `\n[command] ${command}\nexit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n`);
    if (result.code !== 0) return { ok: false, results };
  }
  return { ok: true, results };
}

async function gitDiffSummary(paths = []) {
  const pathArgs = paths.length ? ["--", ...paths] : ["--", "."];
  const statusArgs = paths.length ? ["status", "--short", "--untracked-files=all", "--", ...paths] : ["status", "--short"];
  const status = await execText("git", statusArgs, 30000).catch((error) => error.stdout || error.message);
  const stat = await execText("git", ["diff", "--stat", ...pathArgs], 30000).catch((error) => error.stdout || error.message);
  let diff = await execText("git", ["diff", ...pathArgs], 30000).catch((error) => error.stdout || error.message);
  const untracked = status.split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim());
  for (const file of untracked) {
    const safe = relativeSafePath(file);
    const content = await readOptionalText(safe.absolute, 30000);
    diff += `\n--- /dev/null\n+++ b/${file}\n${content.split(/\r?\n/).map((line) => `+${line}`).join("\n")}\n`;
  }
  return { status, stat, diff: diff.slice(0, 80000) };
}

async function reviewDiff(config, task, diffSummary) {
  if (!diffSummary.status.trim()) return { pass: false, notes: "Task produced no scoped file changes.", risk: "high" };
  const model = config.routing?.reviewerModel || config.reviewModel || config.fallbackModel || config.primaryModel;
  const operatorContext = await readOperatorContext(task.id);
  const acceptance = Array.isArray(task.acceptance) ? task.acceptance : [];
  const prompt = `You are reviewing a local Git diff for a bounded autonomous worker task.

Task:
${JSON.stringify(task, null, 2)}

Operator plan:
${operatorContext.activePlan || "(none provided)"}

Test patterns:
${operatorContext.testPatterns || "(none provided)"}

Guardrails:
${operatorContext.guardrails || "(none provided)"}

Diff stat:
${diffSummary.stat}

Diff excerpt:
${diffSummary.diff}

Review every acceptance item against concrete evidence in the diff. A passing build
does not prove semantic acceptance. Reject missing behavior, placeholders, unsafe
shortcuts, weak types such as any, or claims that are not visible in the diff.

Return only JSON:
{"pass":true|false,"notes":"short reason","risk":"low|medium|high","checks":[{"index":0,"pass":true|false,"evidence":"specific diff evidence or missing requirement"}]}`;
  const response = await ollamaGenerate(config, model, prompt, 10 * 60 * 1000, {
    jsonMode: true,
    telemetry: { agent: "local-reviewer", phase: "diff-review", taskId: task.id }
  });
  const review = extractJsonObject(response);
  const checks = Array.isArray(review.checks) ? review.checks : [];
  const completeChecklist = acceptance.every((_, index) => {
    const check = checks.find((item) => item?.index === index);
    return check?.pass === true && typeof check.evidence === "string" && check.evidence.trim().length > 0;
  });
  return {
    pass: review.pass === true && completeChecklist,
    notes: completeChecklist ? String(review.notes || "") : "Reviewer did not substantiate every acceptance criterion.",
    risk: String(review.risk || "unknown"),
    checks
  };
}

async function commitTask(task, paths) {
  await execText("git", ["add", "--", ...paths], 30000);
  const staged = await execText("git", ["diff", "--cached", "--name-only", "--", ...paths], 30000);
  if (!staged.trim()) throw new Error("No scoped changes were staged for the task.");
  const message = `${task.id}: ${task.title}`;
  await execText("git", ["commit", "-m", message], 120000);
  return message;
}

async function readOperatorContext(taskId) {
  const escalationAnswer = await readOptionalText(path.join(ESCALATION_INBOX, `${taskId}.md`), 6000);
  return {
    activePlan: await readOptionalText(path.join(PLANS_DIR, "ACTIVE_PLAN.md"), 5000),
    testPatterns: await readOptionalText(path.join(PLANS_DIR, "TEST_PATTERNS.md"), 3000),
    guardrails: await readOptionalText(path.join(PLANS_DIR, "GUARDRAILS.md"), 3000),
    escalationAnswer
  };
}

function normalizeLegacyChannelId(channelId) {
  const aliases = {
    "chatgpt-5.4-manual": "gpt-5.4",
    "chatgpt-5.6-manual": "gpt-5.6"
  };
  return aliases[channelId] || channelId;
}

function allEscalationChannels(config) {
  const escalation = config.escalation || {};
  const channels = new Map();

  function add(channel, defaults = {}) {
    if (!channel?.id) return;
    channels.set(channel.id, {
      enabled: true,
      autoInvoke: false,
      ...defaults,
      ...channel
    });
  }

  if (escalation.manualFrontierChannel) {
    add(escalation.manualFrontierChannel, { type: "manual", aliases: ["gpt-5.4"] });
  }
  for (const channel of escalation.frontierChannels || []) add(channel, { type: "codex" });
  for (const channel of escalation.localChannels || []) add(channel, { type: "ollama" });
  for (const channel of escalation.channels || []) add(channel);

  return [...channels.values()];
}

function channelMatches(channel, channelId) {
  if (!channel || !channelId) return false;
  const normalized = normalizeLegacyChannelId(channelId);
  return channel.id === channelId || channel.id === normalized || (channel.aliases || []).includes(channelId) || (channel.aliases || []).includes(normalized);
}

function escalationLadder(config) {
  const escalation = config.escalation || {};
  const channels = allEscalationChannels(config);
  const configuredIds = Array.isArray(escalation.ladder) && escalation.ladder.length
    ? escalation.ladder
    : [
        escalation.manualFrontierChannel?.id,
        ...channels.filter((channel) => channel.type === "codex").map((channel) => channel.id),
        ...channels.filter((channel) => channel.type === "ollama").map((channel) => channel.id)
      ].filter(Boolean);

  const ladder = [];
  for (const id of configuredIds) {
    const channel = channels.find((item) => item.id === id) || channels.find((item) => channelMatches(item, id));
    if (channel && channel.enabled !== false && !ladder.some((item) => item.id === channel.id)) {
      ladder.push(channel);
    }
  }
  return ladder;
}

function findEscalationIndex(ladder, channelId) {
  return ladder.findIndex((channel) => channelMatches(channel, channelId));
}

function selectEscalationChannel(config, taskState) {
  const ladder = escalationLadder(config);
  if (!ladder.length) return { channel: null, index: -1, ladder };

  let index = 0;
  if (taskState.escalationAnswerChannel) {
    const answeredIndex = findEscalationIndex(ladder, taskState.escalationAnswerChannel);
    index = answeredIndex >= 0 ? answeredIndex + 1 : (Number.isInteger(taskState.escalationLadderIndex) ? taskState.escalationLadderIndex + 1 : 0);
  } else if (taskState.escalationChannel) {
    const activeIndex = findEscalationIndex(ladder, taskState.escalationChannel);
    index = activeIndex >= 0 ? activeIndex : 0;
  } else if (Number.isInteger(taskState.escalationLadderIndex)) {
    index = taskState.escalationLadderIndex;
  }

  return { channel: ladder[index] || null, index, ladder };
}

function channelLabel(channel) {
  if (!channel) return "none";
  const model = channel.model ? ` (${channel.model})` : "";
  return `${channel.label || channel.id}${model}`;
}

function appendEscalationHistory(taskState, event) {
  taskState.escalationHistory = Array.isArray(taskState.escalationHistory) ? taskState.escalationHistory : [];
  taskState.escalationHistory.push({ at: new Date().toISOString(), ...event });
  taskState.escalationHistory = taskState.escalationHistory.slice(-12);
}

function parseAnswerChannelId(answer) {
  const match = String(answer || "").match(/^Channel:\s*([^\r\n]+)/im);
  return match ? match[1].trim() : null;
}

async function recordEscalationAnswer(task, taskState, channel, answer, answerPath) {
  const body = `# Escalation Answer: ${task.id}

Channel: ${channel.id}

Model: ${channel.model || "manual"}

Created: ${new Date().toISOString()}

${answer}
`;
  const finalPath = answerPath || path.join(ESCALATION_PROCESSED, `${new Date().toISOString().replace(/[:.]/g, "-")}-${task.id}-${channel.id}.md`);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  if (!answerPath) await fs.writeFile(finalPath, body, "utf8");

  taskState.status = "pending";
  taskState.repairCycles = 0;
  taskState.escalationAnswer = body.slice(0, 20000);
  taskState.escalationAnswerChannel = channel.id;
  taskState.escalationAnswerPath = finalPath;
  taskState.escalationResolvedAt = new Date().toISOString();
  taskState.lastError = null;
  delete taskState.escalationAutoInvokeError;
  appendEscalationHistory(taskState, { event: "answered", channelId: channel.id, answerPath: finalPath });
  return finalPath;
}

async function consumeEscalationAnswers(tasks, state, config) {
  await fs.mkdir(ESCALATION_INBOX, { recursive: true });
  await fs.mkdir(ESCALATION_PROCESSED, { recursive: true });
  const entries = await fs.readdir(ESCALATION_INBOX, { withFileTypes: true }).catch(() => []);
  let consumed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const taskId = entry.name.replace(/\.md$/i, "").split(".")[0];
    const task = tasks.find((item) => item.id === taskId);
    const taskState = state.taskStates[taskId];
    if (!task || !taskState || !["awaiting_escalation", "blocked"].includes(taskState.status)) continue;

    const source = path.join(ESCALATION_INBOX, entry.name);
    const answer = await fs.readFile(source, "utf8");
    const ladder = escalationLadder(config);
    const answerChannelId = parseAnswerChannelId(answer);
    const channel = ladder.find((item) => channelMatches(item, answerChannelId) || channelMatches(item, taskState.escalationChannel)) || {
      id: normalizeLegacyChannelId(taskState.escalationChannel || "manual"),
      type: "manual",
      label: "Manual escalation answer"
    };
    state.lastError = null;
    state.status = "idle";

    const target = path.join(ESCALATION_PROCESSED, `${new Date().toISOString().replace(/[:.]/g, "-")}-${entry.name}`);
    await fs.rename(source, target);
    await recordEscalationAnswer(task, taskState, channel, answer, target);
    await log(`Consumed escalation answer for ${taskId}`, { source: entry.name });
    consumed += 1;
  }

  return consumed;
}

async function normalizeBlockedTasksToEscalations(tasks, state, config) {
  let changed = false;
  for (const task of tasks) {
    const taskState = state.taskStates[task.id];
    if (!taskState || taskState.status !== "blocked" || taskState.escalationRequestedAt) continue;
    if (!config.escalation?.enabled) continue;
    await requestEscalation(task, state, taskState, config, "legacy-blocked-task");
    changed = true;
    await log(`Converted blocked task ${task.id} to awaiting escalation`, { request: taskState.escalationRequestPath });
  }
  return changed;
}

async function autoInvokeAwaitingEscalations(tasks, state, config) {
  if (!config.escalation?.enabled) return 0;
  let invoked = 0;
  for (const task of tasks) {
    const taskState = state.taskStates[task.id];
    if (!taskState || taskState.status !== "awaiting_escalation") continue;

    const ladder = escalationLadder(config);
    const channel = ladder.find((item) => channelMatches(item, taskState.escalationChannel)) || selectEscalationChannel(config, taskState).channel;
    if (!channel?.autoInvoke) continue;
    if (taskState.escalationAnswerChannel && taskState.escalationResolvedAt && channelMatches(channel, taskState.escalationAnswerChannel)) continue;

    let requestPath = taskState.escalationRequestPath;
    if (!requestPath || !existsSync(requestPath)) {
      const request = await createEscalationRequest(task, state, taskState, config, channel, ladder);
      requestPath = request.latestPath;
      taskState.escalationRequestPath = request.latestPath;
      taskState.escalationRequestedAt = request.createdAt;
    }

    await log(`Auto-invoking pending escalation channel ${channel.id} for ${task.id}`, { model: channel.model || channel.type });
    try {
      const result = await invokeEscalationChannel(config, task, channel, requestPath);
      if (result?.answer) {
        const answerPath = await recordEscalationAnswer(task, taskState, channel, result.answer, result.answerPath);
        taskState.escalationChannel = channel.id;
        state.status = "idle";
        state.lastError = null;
        appendEscalationHistory(taskState, { event: "auto-answer", channelId: channel.id, answerPath });
        invoked += 1;
      }
    } catch (error) {
      taskState.escalationAutoInvokeError = String(error.stack || error.message || error).slice(0, 4000);
      appendEscalationHistory(taskState, { event: "auto-invoke-failed", channelId: channel.id, error: taskState.escalationAutoInvokeError });
      state.status = "awaiting_escalation";
      state.lastError = `Auto escalation failed for ${task.id} via ${channel.id}; awaiting manual answer.`;
      await log(`Auto escalation failed for ${task.id}`, { channel: channel.id, error: taskState.escalationAutoInvokeError });
    }
  }
  return invoked;
}

function buildTaskPrompt(task, state, tree, focusFiles, operatorContext) {
  const taskState = state.taskStates[task.id] || {};
  const lastError = taskState.lastError ? `\nPrevious failure to repair:\n${taskState.lastError}\n` : "";
  const escalationGuidance = taskState.escalationAnswer || operatorContext.escalationAnswer;
  return `You are local Qwen, an autonomous software-development worker operating inside this repository only.

You must inspect the provided files before editing. Make bounded, production-minded changes for exactly one task. Keep persistent state compact. Do not add secrets. Do not access paths outside the repository.
The human operator may provide plans, PR details, test patterns, and extra guardrails. Treat them as high-priority task guidance.
Never return placeholders such as "see attached", "add your code here", or "keep existing styles". Every edit must include complete file content.
If stuck, fail compactly; do not improvise with placeholders.

Operator active plan:
${operatorContext.activePlan || "(none provided)"}

Operator test patterns:
${operatorContext.testPatterns || "(none provided)"}

Operator extra guardrails:
${operatorContext.guardrails || "(none provided)"}

Escalation guidance from frontier/local reviewer:
${escalationGuidance || "(none provided)"}

Current task:
${JSON.stringify(task, null, 2)}
${lastError}
Repository file tree:
${tree}

Relevant file contents:
${focusFiles}

Return only JSON with this shape:
{
  "summary": "short summary of intended changes",
  "edits": [
    {"path": "relative/path/from/repo/root", "content": "complete new file content or a native object for a .json file"}
  ],
  "commands": [
    "optional allowlisted command"
  ],
  "notes": ["short note"]
}

Use full-file replacement content for every edited file. For .json paths, content may be a native JSON object and the worker will serialize it. All other content must be a string. If a file should be created, include its full content. If you need dependencies, edit package.json and include "npm install" as a command.`;
}

async function createEscalationRequest(task, state, taskState, config, channel, ladder = []) {
  await fs.mkdir(ESCALATION_OUTBOX, { recursive: true });
  const diffSummary = await gitDiffSummary();
  const operatorContext = await readOperatorContext(task.id);
  const createdAt = new Date().toISOString();
  const safeStamp = createdAt.replace(/[:.]/g, "-");
  const latestPath = path.join(ESCALATION_OUTBOX, `${task.id}.md`);
  const archivePath = path.join(ESCALATION_OUTBOX, `${safeStamp}-${task.id}.md`);
  const targetChannel = channel || config.escalation?.manualFrontierChannel || { id: "manual", label: "Manual escalation" };
  const ladderText = ladder.length ? ladder.map((item) => item.id).join(" -> ") : targetChannel.id;
  const historyText = Array.isArray(taskState.escalationHistory) && taskState.escalationHistory.length
    ? JSON.stringify(taskState.escalationHistory.slice(-6), null, 2)
    : "[]";
  const body = `# Escalation Request: ${task.id} - ${task.title}

Created: ${createdAt}

Requested channel: ${channelLabel(targetChannel)}

Escalation ladder: ${ladderText}

Previous answered channel: ${taskState.escalationAnswerChannel || "none"}

## What I Need

Please unblock the local worker with a compact, implementation-oriented answer. Use sparse foundational inference: do not rewrite the whole project, do not include huge file dumps, and do not spend tokens on generic explanation. Give:

1. Diagnosis of why the local model failed.
2. A minimal recovery plan.
3. Specific file-level guidance for the next local attempt.
4. Any test/validation command expectations.
5. Red flags the local worker must avoid.

The answer will be saved to \`ESCALATIONS/inbox/${task.id}.md\` and injected into the next local-model prompt.

## Channel Instructions

\`\`\`text
${targetChannel.instructions || "Return concise unblock guidance only. Do not edit files directly."}
\`\`\`

## Task

\`\`\`json
${JSON.stringify(task, null, 2)}
\`\`\`

## Operator Plan

\`\`\`markdown
${operatorContext.activePlan || "(none provided)"}
\`\`\`

## Test Patterns

\`\`\`markdown
${operatorContext.testPatterns || "(none provided)"}
\`\`\`

## Guardrails

\`\`\`markdown
${operatorContext.guardrails || "(none provided)"}
\`\`\`

## Last Local Failure

\`\`\`text
${String(taskState.lastError || "").slice(0, 8000)}
\`\`\`

## Escalation History

\`\`\`json
${historyText}
\`\`\`

## Git Status

\`\`\`text
${diffSummary.status.slice(0, 12000)}
\`\`\`

## Diff Stat

\`\`\`text
${diffSummary.stat.slice(0, 8000)}
\`\`\`

## Important Constraint

The next local worker response must provide complete file contents in JSON edits. Placeholder text is rejected.
`;
  await fs.writeFile(latestPath, body, "utf8");
  await fs.writeFile(archivePath, body, "utf8");
  return { createdAt, latestPath };
}

async function invokeOllamaEscalation(config, task, channel, requestPath) {
  const request = await fs.readFile(requestPath, "utf8");
  const prompt = `${request}

You are the local escalation model "${channel.id}" (${channel.model}).
Return concise reviewer guidance only. Do not emit JSON edits. Focus on how the next worker attempt should recover safely.`;
  const answer = await ollamaGenerate(config, channel.model, prompt, 20 * 60 * 1000, {
    num_ctx: channel.contextTokens || config.contextTokens || 16384,
    temperature: channel.temperature ?? 0.1,
    think: channel.think === true,
    telemetry: { agent: channel.id, phase: "escalation", taskId: task.id }
  });
  await unloadModel(config, channel.model);
  await fs.mkdir(ESCALATION_LOCAL, { recursive: true });
  const localPath = path.join(ESCALATION_LOCAL, `${new Date().toISOString().replace(/[:.]/g, "-")}-${task.id}-${channel.id}.md`);
  await fs.writeFile(localPath, answer, "utf8");
  return { answer, answerPath: localPath };
}

async function invokeCodexEscalation(config, task, channel, requestPath) {
  const request = await fs.readFile(requestPath, "utf8");
  const codexCommand = channel.command || config.escalation?.codexCommand || process.env.CODEX_CLI_PATH || "codex";
  const timeoutMs = (channel.timeoutSeconds || 1800) * 1000;
  const codexWorkDir = channel.workDir || config.escalation?.codexWorkDir || path.join(os.tmpdir(), "edgeops-codex-escalations");
  await fs.mkdir(codexWorkDir, { recursive: true });
  await fs.mkdir(ESCALATION_FRONTIER, { recursive: true });
  const outputPath = path.join(ESCALATION_FRONTIER, `${new Date().toISOString().replace(/[:.]/g, "-")}-${task.id}-${channel.id}.md`);
  const prompt = `${request}

You are a frontier escalation agent for a local-first autonomous software loop.

Rules:
- Produce final guidance only. Do not directly edit files.
- Prefer concise, implementation-oriented instructions over broad design prose.
- Use the evidence in the request first. Read extra files only if absolutely necessary.
- Keep the answer under ${channel.maxAnswerWords || 900} words.
- Do not include secrets, tokens, raw logs, or unrelated repository content.
`;
  const args = [
    "exec",
    "-m", channel.model,
    "-C", codexWorkDir,
    "--skip-git-repo-check",
    "--sandbox", channel.sandbox || "read-only",
    "--ephemeral",
    "-o", outputPath
  ];
  if (channel.ignoreRules !== false) args.push("--ignore-rules");
  if (channel.ignoreUserConfig !== false) args.push("--ignore-user-config");
  args.push("-c", "approval_policy=\"never\"");
  if (channel.reasoningEffort) args.push("-c", `model_reasoning_effort="${channel.reasoningEffort}"`);
  args.push("-");

  const result = await execWithInput(codexCommand, args, prompt, timeoutMs);
  if (result.code !== 0) {
    throw new Error(`Codex escalation ${channel.id} failed with exit ${result.code}: ${result.stderr || result.stdout}`);
  }
  const answer = (await readOptionalText(outputPath, 40000)) || result.stdout;
  if (!answer.trim()) throw new Error(`Codex escalation ${channel.id} produced an empty answer.`);
  await recordInference(RUNTIME_DIR, {
    provider: "codex",
    model: channel.model,
    agent: channel.id,
    phase: "escalation",
    taskId: task.id,
    durationMs: 0,
    status: "ok",
    usage: { inputChars: prompt.length, outputChars: answer.length, exact: false }
  });
  return { answer, answerPath: outputPath };
}

async function invokeEscalationChannel(config, task, channel, requestPath) {
  if (channel.type === "ollama") return invokeOllamaEscalation(config, task, channel, requestPath);
  if (channel.type === "codex") return invokeCodexEscalation(config, task, channel, requestPath);
  return null;
}

async function requestEscalation(task, state, taskState, config, reason) {
  const selected = selectEscalationChannel(config, taskState);
  const channel = selected.channel;
  if (!channel) {
    taskState.status = "blocked";
    taskState.blockedAt = new Date().toISOString();
    state.status = "blocked";
    state.currentTaskId = null;
    state.lastError = `Escalation ladder exhausted for ${task.id}.`;
    appendEscalationHistory(taskState, { event: "ladder-exhausted", reason });
    await appendFile(path.join(ROOT, "BLOCKERS.md"), `\n## ${task.id}: ${task.title}\n\nEscalation ladder exhausted.\n\n${taskState.lastError || ""}\n`);
    return { status: "blocked" };
  }

  const request = await createEscalationRequest(task, state, taskState, config, channel, selected.ladder);
  taskState.status = "awaiting_escalation";
  taskState.escalationRequestedAt = request.createdAt;
  taskState.escalationRequestPath = request.latestPath;
  taskState.escalationChannel = channel.id;
  taskState.escalationLadderIndex = selected.index;
  taskState.escalationAutoInvoke = channel.autoInvoke === true;
  state.status = "awaiting_escalation";
  state.currentTaskId = null;
  state.lastError = `Awaiting escalation answer for ${task.id} via ${channel.id}.`;
  appendEscalationHistory(taskState, { event: "requested", channelId: channel.id, requestPath: request.latestPath, reason });

  if (channel.autoInvoke === true) {
    const invokedAt = new Date().toISOString();
    await log(`Auto-invoking escalation channel ${channel.id} for ${task.id}`, { model: channel.model || channel.type });
    try {
      const result = await invokeEscalationChannel(config, task, channel, request.latestPath);
      if (result?.answer) {
        const answerPath = await recordEscalationAnswer(task, taskState, channel, result.answer, result.answerPath);
        state.status = "idle";
        state.lastError = null;
        appendEscalationHistory(taskState, { event: "auto-answer", channelId: channel.id, invokedAt, answerPath });
        await log(`Auto escalation answered ${task.id}`, { channel: channel.id, answerPath });
        return { status: "answered", channel, request };
      }
    } catch (error) {
      taskState.escalationAutoInvokeError = String(error.stack || error.message || error).slice(0, 4000);
      appendEscalationHistory(taskState, { event: "auto-invoke-failed", channelId: channel.id, error: taskState.escalationAutoInvokeError });
      await log(`Auto escalation failed for ${task.id}`, { channel: channel.id, error: taskState.escalationAutoInvokeError });
    }
  }

  await appendFile(path.join(ROOT, "BLOCKERS.md"), `\n## ${task.id}: ${task.title}\n\nAwaiting escalation answer via ${channel.id}: ${request.latestPath}\n\n${taskState.lastError || ""}\n`);
  return { status: "awaiting_escalation", channel, request };
}

async function runLocalEscalation() {
  const taskId = process.argv[process.argv.indexOf("--escalate") + 1];
  if (!taskId || taskId.startsWith("--")) throw new Error("Use --escalate <TASK_ID>.");
  const channelFlag = process.argv.indexOf("--channel");
  const channelId = channelFlag >= 0 ? process.argv[channelFlag + 1] : null;
  const config = await loadConfig();
  const state = await loadState(config);
  const tasks = await extractTasks();
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  const taskState = state.taskStates[taskId] || { status: "awaiting_escalation", attempts: 0, repairCycles: 0 };
  state.taskStates[taskId] = taskState;

  const channels = allEscalationChannels(config);
  const channel = channels.find((item) => item.enabled !== false && (!channelId || channelMatches(item, channelId)));
  if (!channel) throw new Error(`No enabled escalation channel${channelId ? ` named ${channelId}` : ""}.`);

  let request = await readOptionalText(path.join(ESCALATION_OUTBOX, `${taskId}.md`), 40000);
  let requestPath = path.join(ESCALATION_OUTBOX, `${taskId}.md`);
  if (!request) {
    const created = await createEscalationRequest(task, state, taskState, config, channel, escalationLadder(config));
    requestPath = created.latestPath;
    request = await fs.readFile(created.latestPath, "utf8");
  }

  if (request && !existsSync(requestPath)) {
    await fs.mkdir(ESCALATION_OUTBOX, { recursive: true });
    await fs.writeFile(requestPath, request, "utf8");
  }

  const result = await invokeEscalationChannel(config, task, channel, requestPath);
  if (!result?.answer) throw new Error(`Channel ${channel.id} is manual-only; open ${requestPath} and save an answer into ESCALATIONS/inbox/${taskId}.md.`);

  await fs.mkdir(ESCALATION_INBOX, { recursive: true });
  const inboxPath = path.join(ESCALATION_INBOX, `${taskId}.md`);
  const body = `# Escalation Answer: ${taskId}

Channel: ${channel.id}

Model: ${channel.model || "manual"}

Created: ${new Date().toISOString()}

${result.answer}
`;
  await fs.writeFile(inboxPath, body, "utf8");
  console.log(JSON.stringify({ ok: true, taskId, channel: channel.id, model: channel.model || channel.type, inboxPath, answerPath: result.answerPath }, null, 2));
}

async function processTask(task, config, state) {
  const taskState = state.taskStates[task.id] || { status: "pending", attempts: 0, repairCycles: 0 };
  taskState.status = "running";
  taskState.attempts = (taskState.attempts || 0) + 1;
  taskState.startedAt = taskState.startedAt || new Date().toISOString();
  state.currentTaskId = task.id;
  state.status = "running";
  state.lastError = null;
  state.workerPid = process.pid;
  taskState.lastError = null;
  taskState.lease = {
    pid: process.pid,
    acquiredAt: new Date().toISOString()
  };
  state.taskStates[task.id] = taskState;
  await saveState(state);

  const model = taskState.repairCycles > 0
    ? (config.routing?.repairModel || state.fallbackModel)
    : (config.routing?.implementerModel || state.primaryModel);
  await log(`Starting task ${task.id} with ${model}`);

  let editBackups = [];
  try {
    const tree = await listTree();
    const focusFiles = await readFocusFiles(task);
    const operatorContext = await readOperatorContext(task.id);
    const prompt = buildTaskPrompt(task, state, tree, focusFiles, operatorContext);
    const raw = await ollamaGenerate(config, model, prompt, 20 * 60 * 1000, {
      jsonMode: true,
      telemetry: {
        agent: taskState.repairCycles > 0 ? "local-repairer" : "local-implementer",
        phase: taskState.repairCycles > 0 ? "repair" : "implementation",
        taskId: task.id,
        onProgress: async ({ outputChars }) => {
          taskState.lease.lastProgressAt = new Date().toISOString();
          taskState.lease.outputChars = outputChars;
          await saveState(state);
        }
      }
    });
    await appendFile(DETAIL_LOG, `\n[model:${model}] task ${task.id}\n${raw}\n`);
    const action = extractJsonObject(raw);
    const proposal = await validateProposal({ root: ROOT, task, action, config });
    const commitPaths = commitPathsForProposal(proposal);
    await assertEditTargetsClean(commitPaths);
    editBackups = await applyEdits(proposal.edits, commitPaths);

    const modelCommands = proposal.commands;
    const commands = [...modelCommands, ...(task.validation || [])];
    const validation = await runValidation([...new Set(commands)], config);
    if (!validation.ok) {
      throw new Error(`Validation failed: ${JSON.stringify(validation.results.at(-1), null, 2)}`);
    }

    const diffSummary = await gitDiffSummary(commitPaths);
    const review = await reviewDiff(config, task, diffSummary);
    if (!review.pass) throw new Error(`Diff review failed: ${review.notes}`);

    const commit = await commitTask(task, commitPaths);
    taskState.status = "completed";
    taskState.completedAt = new Date().toISOString();
    taskState.lastError = null;
    taskState.commit = commit;
    taskState.review = review;
    state.currentTaskId = null;
    state.status = "idle";
    state.workerPid = process.pid;
    state.lastError = null;
    delete taskState.lease;
    await saveState(state);
    await log(`Completed task ${task.id}`, { commit, review });
  } catch (error) {
    if (editBackups.length && config.restoreFailedAttemptEdits !== false) {
      await restoreEditBackups(editBackups);
      await log(`Restored failed edit attempt for ${task.id}`, { files: editBackups.map((backup) => backup.path) });
    }
    taskState.status = "pending";
    taskState.repairCycles = (taskState.repairCycles || 0) + 1;
    taskState.lastError = String(error.stack || error.message || error).slice(0, 8000);
    state.lastError = taskState.lastError;
    state.currentTaskId = null;
    state.workerPid = process.pid;
    delete taskState.lease;

    if (taskState.repairCycles >= (state.maxRepairCycles || 3)) {
      if (config.escalation?.enabled) {
        if (taskState.escalationAnswerChannel) {
          appendEscalationHistory(taskState, { event: "post-answer-failed", channelId: taskState.escalationAnswerChannel, error: taskState.lastError });
        }
        const result = await requestEscalation(task, state, taskState, config, "max-repair-cycles");
        await log(`Task ${task.id} escalation result`, { status: result.status, channel: result.channel?.id, request: result.request?.latestPath, error: taskState.lastError });
      } else {
        taskState.status = "blocked";
        taskState.blockedAt = new Date().toISOString();
        await appendFile(path.join(ROOT, "BLOCKERS.md"), `\n## ${task.id}: ${task.title}\n\n${taskState.lastError}\n`);
        await log(`Blocked task ${task.id}`, { error: taskState.lastError });
      }
    } else {
      await log(`Task ${task.id} needs repair`, { repairCycles: taskState.repairCycles, error: taskState.lastError });
    }

    state.status = taskState.status === "blocked" || taskState.status === "awaiting_escalation"
      ? taskState.status
      : (taskState.escalationAnswerChannel ? "idle" : "repair_wait");
    await saveState(state);
  } finally {
    await unloadModel(config, model);
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function recoverInterruptedTask(state) {
  const running = Object.entries(state.taskStates || {}).filter(([, taskState]) => taskState.status === "running");
  let recovered = false;
  for (const [taskId, taskState] of running) {
    const leasePid = taskState?.lease?.pid || state.workerPid;
    if (taskId === state.currentTaskId && (leasePid === process.pid || processIsAlive(leasePid))) continue;
    taskState.status = "pending";
    taskState.interruptions = (taskState.interruptions || 0) + 1;
    taskState.lastInterruptedAt = new Date().toISOString();
    taskState.lastError = `Recovered interrupted worker lease from process ${leasePid || "unknown"}; retry was not charged as a model failure.`;
    delete taskState.lease;
    state.lastError = taskState.lastError;
    await log(`Recovered interrupted task ${taskId}`, { previousPid: leasePid || null });
    recovered = true;
  }
  if (!recovered) return false;
  state.status = "idle";
  state.currentTaskId = null;
  state.workerPid = process.pid;
  await saveState(state);
  return true;
}

async function runOnce() {
  const config = await loadConfig();
  const state = await loadState(config);
  await recoverInterruptedTask(state);
  state.workerPid = process.pid;

  if (existsSync(STOP_FILE)) return setStatus("stopped", "Stop file exists.");
  if (existsSync(PAUSE_FILE)) return setStatus("paused", "Pause file exists.");

  const busy = await gpuBusy(config);
  if (busy.busy) {
    state.status = "gpu_busy";
    state.currentTaskId = null;
    state.lastError = busy.reason;
    await saveState(state);
    await log("GPU busy; worker paused", { reason: busy.reason });
    console.log(`GPU_BUSY: ${busy.reason}`);
    return;
  }

  const tasks = await extractTasks();
  const consumedAnswers = await consumeEscalationAnswers(tasks, state, config);
  const normalizedEscalations = await normalizeBlockedTasksToEscalations(tasks, state, config);
  const autoInvokedEscalations = await autoInvokeAwaitingEscalations(tasks, state, config);
  if (consumedAnswers || normalizedEscalations || autoInvokedEscalations) {
    await saveState(state);
  }
  if (autoInvokedEscalations) {
    console.log("Escalation answer captured. The next loop iteration will resume local work.");
    return;
  }

  if (allTerminal(tasks, state)) {
    state.status = "complete";
    state.currentTaskId = null;
    state.lastError = null;
    await saveState(state);
    console.log("All tasks are terminal.");
    return;
  }

  const task = nextReadyTask(tasks, state);
  if (!task) {
    const awaiting = tasks.find((item) => taskStatus(state, item.id) === "awaiting_escalation");
    state.status = awaiting ? "awaiting_escalation" : "idle";
    state.currentTaskId = null;
    state.lastError = awaiting
      ? `Awaiting escalation answer for ${awaiting.id}.`
      : "No ready independent task.";
    await saveState(state);
    console.log(state.lastError);
    return;
  }

  await processTask(task, config, state);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function responsiveSleep(totalMs) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (existsSync(STOP_FILE) || existsSync(PAUSE_FILE)) return;
    await sleep(Math.min(5000, deadline - Date.now()));
  }
}

async function runLoop() {
  const config = await loadConfig();
  await log("Worker loop started", { host: os.hostname(), pid: process.pid });
  while (true) {
    if (existsSync(STOP_FILE)) {
      await setStatus("stopped", "Stop file exists.");
      break;
    }
    await runOnce();
    const state = await loadState(config);
    const wait = state.status === "gpu_busy"
      ? config.busySleepSeconds
      : state.status === "repair_wait"
        ? config.repairSleepSeconds
        : config.idleSleepSeconds;
    if (state.status === "stopped") break;
    await responsiveSleep((wait || 120) * 1000);
  }
}

async function printStatus() {
  const config = await loadConfig();
  const state = await loadState(config);
  const tasks = await extractTasks().catch(() => []);
  const counts = tasks.reduce((acc, task) => {
    const status = taskStatus(state, task.id);
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const busy = await gpuBusy(config).catch((error) => ({ busy: null, reason: error.message }));
  const ladder = escalationLadder(config).map((channel) => ({
    id: channel.id,
    type: channel.type,
    model: channel.model || null,
    enabled: channel.enabled !== false,
    autoInvoke: channel.autoInvoke === true,
    reasoningEffort: channel.reasoningEffort || null
  }));
  console.log(JSON.stringify({
    project: ROOT,
    status: state.status,
    currentTaskId: state.currentTaskId,
    lastHeartbeat: state.lastHeartbeat,
    lastError: state.lastError,
    primaryModel: state.primaryModel,
    fallbackModel: state.fallbackModel,
    contextTokens: state.contextTokens,
    escalation: {
      enabled: config.escalation?.enabled === true,
      ladder
    },
    taskCounts: counts,
    gpu: busy
  }, null, 2));
}

async function doctor() {
  const config = await loadConfig();
  const checks = [];
  for (const [name, command, args] of [
    ["git", "git", ["--version"]],
    ["node", "node", ["--version"]],
    ["npm", process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm --version"] : ["--version"]],
    ["ollama", "ollama", ["--version"]],
    ["codex", config.escalation?.codexCommand || "codex", ["--version"]]
  ]) {
    try {
      checks.push({ name, ok: true, output: (await execText(command, args, 10000)).trim() });
    } catch (error) {
      checks.push({ name, ok: false, output: String(error.message || error) });
    }
  }

  try {
    const tags = await fetch(`${config.ollamaUrl}/api/tags`).then((res) => res.json());
    const names = (tags.models || []).map((model) => model.name);
    checks.push({ name: "ollama endpoint", ok: true, output: `${names.length} models` });
    checks.push({ name: "primary model", ok: names.includes(config.primaryModel), output: config.primaryModel });
    checks.push({ name: "fallback model", ok: names.includes(config.fallbackModel), output: config.fallbackModel });
  } catch (error) {
    checks.push({ name: "ollama endpoint", ok: false, output: String(error.message || error) });
  }

  const busy = await gpuBusy(config);
  checks.push({ name: "gpu ownership", ok: !busy.busy, output: busy.busy ? busy.reason : "available" });

  console.log(JSON.stringify({ project: ROOT, checks }, null, 2));
  if (checks.some((check) => !check.ok && check.name !== "gpu ownership")) process.exit(1);
}

async function smokeEdit() {
  const config = await loadConfig();
  const state = await loadState(config);
  const cpuOnly = argv.has("--cpu");
  const busy = await gpuBusy(config);
  if (busy.busy && !cpuOnly) {
    state.status = "gpu_busy";
    state.lastError = `Smoke edit deferred: ${busy.reason}`;
    await saveState(state);
    console.log(`GPU_BUSY: ${busy.reason}`);
    return;
  }
  const prompt = `Return only JSON in this shape:
{"edits":[{"path":"worker-evidence/qwen-edit-proof.md","content":"# Qwen local edit proof\\n\\nOne sentence saying local Qwen created this file through the autonomous worker.\\n"}],"commands":["node worker/smoke-test.mjs"]}

The content must include the exact phrase "Qwen local edit proof".`;
  const raw = await ollamaGenerate(config, state.primaryModel, prompt, 20 * 60 * 1000, cpuOnly ? { num_gpu: 0 } : {});
  await appendFile(DETAIL_LOG, `\n[smoke-edit]\n${raw}\n`);
  const action = extractJsonObject(raw);
  await applyEdits(action.edits || []);
  const validation = await runValidation(action.commands || ["node worker/smoke-test.mjs"], config);
  if (!validation.ok) throw new Error("Smoke validation failed.");
  const diff = await gitDiffSummary();
  const review = await reviewDiff(config, state.primaryModel, { id: "SMOKE", title: "Qwen edit proof" }, diff);
  if (!review.pass) throw new Error(`Smoke diff review failed: ${review.notes}`);
  const commit = await commitTask({ id: "SMOKE", title: "Qwen edit proof" });
  state.status = "idle";
  state.lastError = null;
  state.smokeEdit = { completedAt: new Date().toISOString(), commit, review };
  await saveState(state);
  await unloadModel(config, state.primaryModel);
  console.log("Smoke edit completed.");
}

async function benchmarkModels() {
  const config = await loadConfig();
  const state = await loadState(config);
  const cpuOnly = argv.has("--cpu");
  const busy = await gpuBusy(config);
  if (busy.busy && !cpuOnly) {
    state.status = "gpu_busy";
    state.lastError = `Benchmark deferred: ${busy.reason}`;
    await saveState(state);
    console.log(`GPU_BUSY: ${busy.reason}`);
    return;
  }
  const models = [state.primaryModel, state.fallbackModel];
  const results = [];
  for (const model of models) {
    const started = Date.now();
    const response = await ollamaGenerate(config, model, "Return one TypeScript function named add that adds two numbers. No explanation.", 10 * 60 * 1000, cpuOnly ? { num_gpu: 0 } : {});
    const elapsedMs = Date.now() - started;
    results.push({ model, elapsedMs, cpuOnly, ok: /function\s+add|const\s+add/.test(response), response: response.slice(0, 500) });
    await unloadModel(config, model);
  }
  state.benchmark = { completedAt: new Date().toISOString(), results };
  state.lastError = null;
  await saveState(state);
  console.log(JSON.stringify(state.benchmark, null, 2));
}

main().catch(async (error) => {
  const config = await loadConfig().catch(() => ({}));
  const state = await loadState(config).catch(() => defaultState(config));
  state.status = "error";
  state.lastError = String(error.stack || error.message || error).slice(0, 8000);
  await saveState(state).catch(() => {});
  console.error(error);
  process.exit(1);
});
