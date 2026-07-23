import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  if (argv.has("--once")) return runOnce();
  if (argv.has("--loop")) return runLoop();

  console.log("Usage: node worker/qwen-worker.mjs --doctor|--status|--once|--loop|--smoke-edit|--benchmark");
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
    lastError: null,
    benchmark: null,
    taskStates: {}
  };
}

async function loadState(config = {}) {
  return { ...defaultState(config), ...(await readJson(STATE_PATH, {})) };
}

async function saveState(state) {
  state.lastHeartbeat = new Date().toISOString();
  const tmp = `${STATE_PATH}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tmp, STATE_PATH);
}

async function setStatus(status, error) {
  const config = await loadConfig();
  const state = await loadState(config);
  state.status = status;
  state.currentTaskId = null;
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

function relativeSafePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") throw new Error("Missing path.");
  const normalized = inputPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("..") || path.isAbsolute(inputPath)) {
    throw new Error(`Unsafe path outside repository: ${inputPath}`);
  }
  const absolute = path.resolve(ROOT, normalized);
  if (!absolute.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep)) {
    throw new Error(`Unsafe path outside repository: ${inputPath}`);
  }
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
    if (status === "completed" || status === "blocked" || status === "running") continue;
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
  return files.slice(0, 180).join("\n");
}

async function readFocusFiles(task) {
  const files = new Set(["SPEC.md", "ARCHITECTURE.md", "AGENTS.md", "DECISIONS.md", "BLOCKERS.md", "WORKER_STATE.json", "package.json"]);
  for (const focus of task.focus || []) {
    const safe = relativeSafePath(focus);
    if (!existsSync(safe.absolute)) continue;
    const stat = await fs.stat(safe.absolute);
    if (stat.isFile()) files.add(safe.normalized);
    if (stat.isDirectory()) {
      const children = await fs.readdir(safe.absolute, { withFileTypes: true });
      for (const child of children.slice(0, 30)) {
        if (child.isFile()) files.add(path.posix.join(safe.normalized, child.name));
      }
    }
  }

  const chunks = [];
  for (const file of files) {
    try {
      const safe = relativeSafePath(file);
      const stat = await fs.stat(safe.absolute);
      if (stat.size > 50000) continue;
      const content = await fs.readFile(safe.absolute, "utf8");
      chunks.push(`--- ${file} ---\n${content.slice(0, 18000)}`);
    } catch {
      // Ignore unreadable focus files.
    }
  }
  return chunks.join("\n\n").slice(0, 70000);
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

async function ollamaGenerate(config, model, prompt, timeoutMs = 20 * 60 * 1000, extraOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        keep_alive: config.keepAlive || "2m",
        options: {
          num_ctx: config.contextTokens || 16384,
          temperature: config.temperature ?? 0.15,
          ...extraOptions
        }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.response || "";
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

async function applyEdits(edits) {
  if (!Array.isArray(edits)) throw new Error("Model JSON must include edits array.");
  for (const edit of edits) {
    const safe = relativeSafePath(edit.path);
    if (typeof edit.content !== "string") throw new Error(`Edit for ${edit.path} is missing string content.`);
    validateEditContent(safe.normalized, edit.content);
    await fs.mkdir(path.dirname(safe.absolute), { recursive: true });
    await fs.writeFile(safe.absolute, edit.content, "utf8");
  }
}

function validateEditContent(relativePath, content) {
  const trimmed = content.trim();
  const placeholderPatterns = [
    /^see attached/i,
    /add your .* here/i,
    /keep existing .* styles/i,
    /keep existing .* components/i,
    /remove this file or replace/i,
    /\.\.\. keep existing/i,
    /\{\s*\/\*\s*add your/i
  ];
  const matched = placeholderPatterns.find((pattern) => pattern.test(trimmed));
  if (matched) {
    throw new Error(`Rejected placeholder edit for ${relativePath}: ${matched}`);
  }
  if (relativePath.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(`Rejected invalid JSON for ${relativePath}: ${error.message}`);
    }
  }
  if (relativePath === "package.json") {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(`Rejected invalid package.json: ${error.message}`);
    }
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

async function gitDiffSummary() {
  const status = await execText("git", ["status", "--short"], 30000).catch((error) => error.stdout || error.message);
  const stat = await execText("git", ["diff", "--stat"], 30000).catch((error) => error.stdout || error.message);
  const diff = await execText("git", ["diff", "--", "."], 30000).catch((error) => error.stdout || error.message);
  return { status, stat, diff: diff.slice(0, 60000) };
}

async function reviewDiff(config, model, task, diffSummary) {
  if (!diffSummary.status.trim()) return { pass: true, notes: "No file changes." };
  const prompt = `You are reviewing a local Git diff for a bounded autonomous worker task.

Task:
${JSON.stringify(task, null, 2)}

Diff stat:
${diffSummary.stat}

Diff excerpt:
${diffSummary.diff}

Return only JSON:
{"pass":true|false,"notes":"short reason","risk":"low|medium|high"}`;
  const response = await ollamaGenerate(config, model, prompt, 10 * 60 * 1000);
  const review = extractJsonObject(response);
  return { pass: review.pass === true, notes: String(review.notes || ""), risk: String(review.risk || "unknown") };
}

async function commitTask(task) {
  const status = await execText("git", ["status", "--short"], 30000);
  if (!status.trim()) return "No changes to commit.";
  await execText("git", ["add", "-A"], 30000);
  const message = `${task.id}: ${task.title}`;
  await execText("git", ["commit", "-m", message], 120000);
  return message;
}

function buildTaskPrompt(task, state, tree, focusFiles) {
  const taskState = state.taskStates[task.id] || {};
  const lastError = taskState.lastError ? `\nPrevious failure to repair:\n${taskState.lastError}\n` : "";
  return `You are local Qwen, an autonomous software-development worker operating inside this repository only.

You must inspect the provided files before editing. Make bounded, production-minded changes for exactly one task. Keep persistent state compact. Do not add secrets. Do not access paths outside the repository.

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
    {"path": "relative/path/from/repo/root", "content": "complete new file content"}
  ],
  "commands": [
    "optional allowlisted command"
  ],
  "notes": ["short note"]
}

Use full-file replacement content for every edited file. If a file should be created, include its full content. If you need dependencies, edit package.json and include "npm install" as a command.`;
}

async function processTask(task, config, state) {
  const taskState = state.taskStates[task.id] || { status: "pending", attempts: 0, repairCycles: 0 };
  taskState.status = "running";
  taskState.attempts = (taskState.attempts || 0) + 1;
  taskState.startedAt = taskState.startedAt || new Date().toISOString();
  state.currentTaskId = task.id;
  state.status = "running";
  state.taskStates[task.id] = taskState;
  await saveState(state);

  const model = taskState.repairCycles > 0 ? state.fallbackModel : state.primaryModel;
  await log(`Starting task ${task.id} with ${model}`);

  try {
    const tree = await listTree();
    const focusFiles = await readFocusFiles(task);
    const prompt = buildTaskPrompt(task, state, tree, focusFiles);
    const raw = await ollamaGenerate(config, model, prompt);
    await appendFile(DETAIL_LOG, `\n[model:${model}] task ${task.id}\n${raw}\n`);
    const action = extractJsonObject(raw);
    await applyEdits(action.edits || []);

    const modelCommands = Array.isArray(action.commands) ? action.commands : [];
    const commands = [...modelCommands, ...(task.validation || [])];
    const validation = await runValidation([...new Set(commands)], config);
    if (!validation.ok) {
      throw new Error(`Validation failed: ${JSON.stringify(validation.results.at(-1), null, 2)}`);
    }

    const diffSummary = await gitDiffSummary();
    const review = await reviewDiff(config, model, task, diffSummary);
    if (!review.pass) throw new Error(`Diff review failed: ${review.notes}`);

    const commit = await commitTask(task);
    taskState.status = "completed";
    taskState.completedAt = new Date().toISOString();
    taskState.lastError = null;
    taskState.commit = commit;
    taskState.review = review;
    state.currentTaskId = null;
    state.status = "idle";
    state.lastError = null;
    await saveState(state);
    await log(`Completed task ${task.id}`, { commit, review });
  } catch (error) {
    taskState.status = "pending";
    taskState.repairCycles = (taskState.repairCycles || 0) + 1;
    taskState.lastError = String(error.stack || error.message || error).slice(0, 8000);
    state.lastError = taskState.lastError;
    state.currentTaskId = null;

    if (taskState.repairCycles >= (state.maxRepairCycles || 3)) {
      taskState.status = "blocked";
      taskState.blockedAt = new Date().toISOString();
      await appendFile(path.join(ROOT, "BLOCKERS.md"), `\n## ${task.id}: ${task.title}\n\n${taskState.lastError}\n`);
      await log(`Blocked task ${task.id}`, { error: taskState.lastError });
    } else {
      await log(`Task ${task.id} needs repair`, { repairCycles: taskState.repairCycles, error: taskState.lastError });
    }

    state.status = taskState.status === "blocked" ? "idle" : "repair_wait";
    await saveState(state);
  } finally {
    await unloadModel(config, model);
  }
}

async function runOnce() {
  const config = await loadConfig();
  const state = await loadState(config);

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
    state.status = "idle";
    state.currentTaskId = null;
    state.lastError = "No ready independent task.";
    await saveState(state);
    console.log("No ready independent task.");
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
    const wait = state.status === "gpu_busy" ? config.busySleepSeconds : config.idleSleepSeconds;
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
  console.log(JSON.stringify({
    project: ROOT,
    status: state.status,
    currentTaskId: state.currentTaskId,
    lastHeartbeat: state.lastHeartbeat,
    lastError: state.lastError,
    primaryModel: state.primaryModel,
    fallbackModel: state.fallbackModel,
    contextTokens: state.contextTokens,
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
    ["ollama", "ollama", ["--version"]]
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
