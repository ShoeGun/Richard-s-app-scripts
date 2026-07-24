import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTelemetry } from "./lib/telemetry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(__dirname, "dashboard");
const RUNTIME_DIR = path.join(__dirname, "runtime");
const PORT = Number(process.env.EDGEOPS_CONTROL_PORT || 3210);
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;
const CONTEXT_FILES = {
  activePlan: path.join(ROOT, "PLANS", "ACTIVE_PLAN.md"),
  testPatterns: path.join(ROOT, "PLANS", "TEST_PATTERNS.md"),
  guardrails: path.join(ROOT, "PLANS", "GUARDRAILS.md")
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

async function extractTasks() {
  const markdown = await fs.readFile(path.join(ROOT, "TASKS.md"), "utf8");
  const match = markdown.match(/```worker-task-queue\s*([\s\S]*?)```/);
  return match ? JSON.parse(match[1]) : [];
}

function run(command, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: ROOT,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    }, (error, stdout, stderr) => {
      if (error) {
        error.output = `${stdout}${stderr}`;
        reject(error);
      } else {
        resolve(`${stdout}${stderr}`);
      }
    });
  });
}

async function health(url) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: response.ok || response.status === 401, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

async function voiceboxHealth() {
  const startedAt = Date.now();
  try {
    const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(7000) });
    const body = await response.json();
    const tts = body.tts || {};
    const ttsReady = response.ok && tts.status === "online";
    return {
      ok: ttsReady,
      degraded: response.ok && !ttsReady,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      detail: ttsReady
        ? `TTS online${tts.loaded ? " / loaded" : " / cold"}`
        : `gateway online / TTS ${tts.status || "unknown"}`
    };
  } catch (error) {
    return { ok: false, degraded: false, status: null, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

function publicRouting(config) {
  const channels = [
    ...(config.escalation?.localChannels || []),
    ...(config.escalation?.frontierChannels || [])
  ];
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return {
    roles: config.routing || {},
    availableChannels: channels.map((channel) => ({
      id: channel.id,
      type: channel.type || "manual",
      model: channel.model || null,
      enabled: channel.enabled !== false,
      autoInvoke: channel.autoInvoke === true,
      reasoningEffort: channel.reasoningEffort || null
    })),
    ladder: (config.escalation?.ladder || []).map((id) => {
      const channel = byId.get(id) || {};
      return {
        id,
        type: channel.type || "manual",
        model: channel.model || null,
        enabled: channel.enabled !== false,
        autoInvoke: channel.autoInvoke === true,
        reasoningEffort: channel.reasoningEffort || null
      };
    })
  };
}

function taskTokenTotals(events) {
  const totals = {};
  for (const event of events) {
    if (!event.taskId) continue;
    totals[event.taskId] ||= { calls: 0, totalTokens: 0, exactCalls: 0, estimatedCalls: 0 };
    totals[event.taskId].calls += 1;
    totals[event.taskId].totalTokens += event.usage?.totalTokens || 0;
    totals[event.taskId][event.usage?.exact ? "exactCalls" : "estimatedCalls"] += 1;
  }
  return totals;
}

async function collectStatus() {
  const [state, tasks, workerConfig, bridgeState, loopSnapshot, telemetry, gitStatus, serviceHealth] = await Promise.all([
    readJson(path.join(ROOT, "WORKER_STATE.json"), {}),
    extractTasks(),
    readJson(path.join(__dirname, "config.json"), {}),
    readJson(path.join(ROOT, "LOOPS", "loop-bridge-state.json"), {}),
    readJson(path.join(ROOT, "LOOPS", "edgeops-worker-loop.json"), null),
    readTelemetry(RUNTIME_DIR, 200),
    run("git", ["status", "--short"], 10000).catch((error) => error.output || error.message),
    Promise.all([
      health("http://127.0.0.1:3100/api/health"),
      health("http://127.0.0.1:11434/api/version"),
      health("http://127.0.0.1:18789/health"),
      voiceboxHealth()
    ])
  ]);

  const tokenTotals = taskTokenTotals(telemetry.events);
  const taskRows = tasks.map((task) => {
    const taskState = state.taskStates?.[task.id] || {};
    return {
      id: task.id,
      title: task.title,
      objective: task.objective,
      dependsOn: task.dependsOn || [],
      status: taskState.status || "pending",
      attempts: taskState.attempts || 0,
      repairCycles: taskState.repairCycles || 0,
      lastError: taskState.lastError || null,
      escalationChannel: taskState.escalationChannel || null,
      tokens: tokenTotals[task.id] || { calls: 0, totalTokens: 0, exactCalls: 0, estimatedCalls: 0 }
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    worker: {
      status: state.status || "unknown",
      currentTaskId: state.currentTaskId || null,
      lastHeartbeat: state.lastHeartbeat || null,
      lastError: state.lastError || null,
      pid: state.workerPid || null
    },
    tasks: taskRows,
    routing: publicRouting(workerConfig),
    telemetry,
    paperclip: {
      issueId: bridgeState.paperclipIssueId || null,
      lastSyncedAt: bridgeState.lastSyncedAt || null,
      snapshotAt: loopSnapshot?.capturedAt || null
    },
    services: [
      { name: "Paperclip", url: "http://127.0.0.1:3100", ...serviceHealth[0] },
      { name: "Ollama", url: "http://127.0.0.1:11434", ...serviceHealth[1] },
      { name: "OpenClaw", url: "http://127.0.0.1:18789", ...serviceHealth[2] },
      { name: "Voicebox", url: "http://127.0.0.1:8765", ...serviceHealth[3] }
    ],
    git: { dirty: Boolean(gitStatus.trim()), status: gitStatus.slice(0, 12000) }
  };
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function assertLocalMutation(request) {
  const host = request.headers.host || "";
  const origin = request.headers.origin;
  if (!host.startsWith("127.0.0.1:") && !host.startsWith("localhost:")) {
    throw new Error("Control plane mutations are loopback-only.");
  }
  if (origin && !origin.startsWith(`http://${host}`)) {
    throw new Error("Cross-origin control request rejected.");
  }
}

async function runControl(action) {
  const scripts = {
    start: "start-worker.ps1",
    pause: "pause-worker.ps1",
    resume: "resume-worker.ps1",
    stop: "stop-worker.ps1",
    sync: "sync-loop-once.ps1"
  };
  const script = scripts[action];
  if (!script) throw new Error(`Unknown control action: ${action}`);
  return run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, script)], 30000);
}

async function updateLadder(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
    throw new Error("Escalation ladder must be a non-empty array of channel ids.");
  }
  if (new Set(ids).size !== ids.length) throw new Error("Escalation ladder contains duplicate channels.");
  const configPath = path.join(__dirname, "config.json");
  const config = await readJson(configPath, {});
  const known = new Set([
    ...(config.escalation?.localChannels || []),
    ...(config.escalation?.frontierChannels || [])
  ].filter((channel) => channel.enabled !== false).map((channel) => channel.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown or disabled channels: ${unknown.join(", ")}`);
  config.escalation.ladder = ids;
  await writeJsonAtomic(configPath, config);
}

async function readOperatorContext() {
  const entries = await Promise.all(Object.entries(CONTEXT_FILES).map(async ([key, filePath]) => {
    const value = await fs.readFile(filePath, "utf8").catch(() => "");
    return [key, value];
  }));
  return Object.fromEntries(entries);
}

async function updateOperatorContext(body) {
  for (const [key, filePath] of Object.entries(CONTEXT_FILES)) {
    if (!(key in body)) continue;
    if (typeof body[key] !== "string" || body[key].length > 100000) {
      throw new Error(`${key} must be text under 100,000 characters.`);
    }
    await fs.writeFile(filePath, body[key], "utf8");
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const normalized = path.normalize(requested);
  const filePath = path.resolve(DASHBOARD_DIR, normalized);
  if (!filePath.startsWith(`${DASHBOARD_DIR}${path.sep}`) && filePath !== path.join(DASHBOARD_DIR, "index.html")) {
    return sendJson(response, 404, { error: "Not found" });
  }
  if (!existsSync(filePath)) return sendJson(response, 404, { error: "Not found" });
  response.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    "x-content-type-options": "nosniff"
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, await collectStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/operator-context") {
      return sendJson(response, 200, await readOperatorContext());
    }
    if (request.method === "POST" && url.pathname === "/api/control") {
      assertLocalMutation(request);
      const body = await readBody(request);
      return sendJson(response, 200, { ok: true, output: await runControl(body.action) });
    }
    if (request.method === "POST" && url.pathname === "/api/escalation/ladder") {
      assertLocalMutation(request);
      const body = await readBody(request);
      await updateLadder(body.ids);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/operator-context") {
      assertLocalMutation(request);
      const body = await readBody(request);
      await updateOperatorContext(body);
      return sendJson(response, 200, { ok: true });
    }
    return serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EdgeOps Control Plane listening on http://${HOST}:${PORT}`);
});
