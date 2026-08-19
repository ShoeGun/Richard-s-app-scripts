import { execFile, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readTelemetry } from "./lib/telemetry.mjs";
import { createAgenticOsProxy } from "./lib/agentic-os-proxy.mjs";
import {
  createLocalDashboardSession,
  ensureEdgeOpsControlCapability,
  requestHasEdgeOpsControlCapability
} from "./lib/local-dashboard-session.mjs";
import { assertExactLocalMutation } from "./lib/local-mutation-boundary.mjs";
import { createCanonicalComfyControl } from "./lib/canonical-comfy-control.mjs";
import {
  deleteStoredSecret,
  secretStatus,
  secretsConfigured,
  setStoredSecret
} from "./lib/secret-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DASHBOARD_DIR = path.join(__dirname, "dashboard");
const RUNTIME_DIR = path.join(__dirname, "runtime");
const PORT = Number(process.env.EDGEOPS_CONTROL_PORT || 3210);
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;
const AGENTIC_OS_BODY_BYTES = 1024;
const SSH_CONFIG_PATH = process.env.EDGEOPS_SSH_CONFIG || "C:\\Users\\Richard\\.ssh\\config";
const escalationJobs = new Map();
const canonicalComfyControl = createCanonicalComfyControl();
const agenticOsProxy = createAgenticOsProxy();
const edgeOpsCapabilityPath = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, "AppData", "Local"), "AgenticOS", "edgeops-control.capability");
const edgeOpsCapabilityPromise = ensureEdgeOpsControlCapability({ filePath: edgeOpsCapabilityPath });
const edgeOpsBrowserSessions = createLocalDashboardSession();
const CONTEXT_FILES = {
  activePlan: path.join(ROOT, "PLANS", "ACTIVE_PLAN.md"),
  testPatterns: path.join(ROOT, "PLANS", "TEST_PATTERNS.md"),
  guardrails: path.join(ROOT, "PLANS", "GUARDRAILS.md")
};
const CONNECTIONS = {
  groq: {
    label: "Groq Free",
    secretName: "GROQ_API_KEY",
    detail: "GPT-OSS 120B free inference"
  },
  openrouter: {
    label: "OpenRouter Free",
    secretName: "OPENROUTER_API_KEY",
    detail: "Free-model router used directly by the EdgeOps worker"
  },
  github: {
    label: "GitHub Models",
    secretName: "GITHUB_TOKEN",
    detail: "Fine-grained PAT with Models: read"
  },
  copilot: {
    label: "GitHub Copilot CLI",
    secretName: "COPILOT_GITHUB_TOKEN",
    detail: "Copilot Requests token or interactive CLI login"
  },
  zai: {
    label: "Z.ai Coding Plan",
    secretName: "ZAI_API_KEY",
    detail: "GLM through the supported Hermes harness",
    remoteTargets: ["hermes"]
  },
  google: {
    label: "Google AI / Gemini",
    secretName: "GOOGLE_API_KEY",
    detail: "Gemini TTS and Live API"
  },
  elevenlabs: {
    label: "ElevenLabs",
    secretName: "ELEVENLABS_API_KEY",
    detail: "Speech, Scribe STT, and realtime transcription",
    remoteTargets: ["openclaw"]
  },
  resemble: {
    label: "Resemble AI",
    secretName: "RESEMBLE_API_KEY",
    detail: "Cloud speech API; Resemble also publishes the separate local DramaBox model"
  }
};
const REMOTE_ENV_TARGETS = {
  hermes: {
    envPath: ".hermes/.env"
  },
  openclaw: {
    envPath: ".openclaw/.env",
    refreshCommand: "~/.nvm/versions/node/v24.18.0/bin/node ~/pinokio/bin/miniconda/lib/node_modules/openclaw/dist/index.js secrets reload --json --timeout 10000"
  }
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

async function openclawHealth(config) {
  const service = config.managedServices?.openclaw || {};
  const startedAt = Date.now();
  const remoteCommand = `curl -sS --max-time 8 http://127.0.0.1:${service.port || 18789}/health`;
  try {
    const output = await run(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-F", SSH_CONFIG_PATH, service.sshHost || "openclaw-mac", remoteCommand],
      12000
    );
    const body = JSON.parse(output.trim());
    const running = body.status === "live" && body.ok === true;
    return {
      ok: running,
      status: running ? 200 : null,
      latencyMs: Date.now() - startedAt,
      detail: `OpenClaw Mac gateway live on ${service.sshHost || "openclaw-mac"}`
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: `Mac gateway probe failed: ${(error.output || error.message).slice(0, 300)}`
    };
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
      body,
      detail: ttsReady
        ? `TTS online${tts.loaded ? " / loaded" : " / cold"}`
        : `gateway online / TTS ${tts.status || "unknown"}`
    };
  } catch (error) {
    return { ok: false, degraded: false, status: null, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

async function antigravityHealth(config) {
  const startedAt = Date.now();
  const command = config.escalation?.antigravityCommand
    || config.escalation?.channels?.find((channel) => channel.type === "antigravity")?.command
    || process.env.AGY_CLI_PATH
    || "agy";
  try {
    const output = await run(command, ["--version"], 7000);
    return { ok: true, status: 0, latencyMs: Date.now() - startedAt, detail: `agy ${output.trim()}` };
  } catch (error) {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: (error.output || error.message).slice(0, 300) };
  }
}

async function hermesHealth(config) {
  const channel = [
    ...(config.escalation?.channels || []),
    ...(config.escalation?.localChannels || [])
  ].find((item) => item.type === "hermes" && item.enabled !== false);
  const startedAt = Date.now();
  try {
    const response = await fetch(channel?.healthUrl || "http://127.0.0.1:18642/health", {
      signal: AbortSignal.timeout(3000)
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      detail: response.ok
        ? `${body.platform || "hermes-agent"} ${body.version || ""}`.trim()
        : `HTTP ${response.status}`
    };
  } catch (error) {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

async function colibriHealth(config) {
  const service = config.managedServices?.["colibri-glm52"] || {};
  const startedAt = Date.now();
  try {
    const [healthResponse, modelsResponse] = await Promise.all([
      fetch(service.healthUrl || "http://127.0.0.1:1236/health", { signal: AbortSignal.timeout(3000) }),
      fetch(service.modelsUrl || "http://127.0.0.1:1236/v1/models", { signal: AbortSignal.timeout(3000) })
    ]);
    const models = await modelsResponse.json().catch(() => ({}));
    const modelIds = Array.isArray(models.data) ? models.data.map((model) => model.id).filter(Boolean) : [];
    return {
      ok: healthResponse.ok && modelsResponse.ok && modelIds.includes("glm-5.2-colibri"),
      status: healthResponse.status,
      latencyMs: Date.now() - startedAt,
      detail: modelIds.length ? `GLM 5.2 Colibri ready (${modelIds.join(", ")})` : "Endpoint online; model not advertised"
    };
  } catch (error) {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: error.message };
  }
}

async function comfyHealth(config) {
  const service = config.managedServices?.comfyui || {};
  const startedAt = Date.now();
  try {
    const response = await fetch(service.healthUrl || "http://127.0.0.1:8188/system_stats", {
      signal: AbortSignal.timeout(3000)
    });
    const body = await response.json().catch(() => ({}));
    const device = body.devices?.[0]?.name || body.devices?.[0]?.type || "GPU runtime";
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      detail: response.ok ? `API online / ${device}` : `HTTP ${response.status}`
    };
  } catch {
    return { ok: false, status: null, latencyMs: Date.now() - startedAt, error: "offline; start with scripts/start-comfyui.ps1" };
  }
}

function publicRouting(config) {
  const channels = [
    ...(config.escalation?.localChannels || []),
    ...(config.escalation?.channels || []),
    ...(config.escalation?.frontierChannels || [])
  ];
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const configured = (channel) => {
    const names = [
      ...(Array.isArray(channel.apiKeyEnvs) ? channel.apiKeyEnvs : []),
      channel.apiKeyEnv
    ].filter(Boolean);
    return secretsConfigured(names);
  };
  return {
    roles: config.routing || {},
    availableChannels: channels.map((channel) => ({
      id: channel.id,
      type: channel.type || "manual",
      model: channel.model || null,
      enabled: channel.enabled !== false,
      autoInvoke: channel.autoInvoke === true,
      configured: configured(channel),
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
        configured: configured(channel),
        reasoningEffort: channel.reasoningEffort || null
      };
    })
  };
}

function providerBudgetUsage(events, budgets = [], windowHours = 24) {
  const usage = new Map();
  const windowStart = Date.now() - Math.max(1, Number(windowHours)) * 60 * 60 * 1000;
  const minuteStart = Date.now() - 60 * 1000;
  for (const event of events || []) {
    const key = event.provider || "unknown";
    const current = usage.get(key) || {
      provider: key,
      calls: 0,
      totalTokens: 0,
      allTimeCalls: 0,
      allTimeTokens: 0,
      exactCalls: 0,
      estimatedCalls: 0,
      minuteCalls: 0,
      minuteTokens: 0,
      durationMs: 0,
      lastUsedAt: null,
      models: {},
      tasks: {}
    };
    current.allTimeCalls += 1;
    current.allTimeTokens += event.usage?.totalTokens || 0;
    if (Date.parse(event.capturedAt) < windowStart) {
      usage.set(key, current);
      continue;
    }
    current.calls += 1;
    current.totalTokens += event.usage?.totalTokens || 0;
    current.exactCalls += event.usage?.exact ? 1 : 0;
    current.estimatedCalls += event.usage?.exact ? 0 : 1;
    if (Date.parse(event.capturedAt) >= minuteStart) {
      current.minuteCalls += 1;
      current.minuteTokens += event.usage?.totalTokens || 0;
    }
    current.durationMs += event.durationMs || 0;
    current.lastUsedAt = current.lastUsedAt && Date.parse(current.lastUsedAt) > Date.parse(event.capturedAt)
      ? current.lastUsedAt
      : event.capturedAt;
    current.models[event.model || "unknown"] = (current.models[event.model || "unknown"] || 0) + (event.usage?.totalTokens || 0);
    if (event.taskId) current.tasks[event.taskId] = (current.tasks[event.taskId] || 0) + (event.usage?.totalTokens || 0);
    usage.set(key, current);
  }

  const configured = budgets.map((budget) => {
    const current = usage.get(budget.provider) || {
      provider: budget.provider,
      calls: 0,
      totalTokens: 0,
      allTimeCalls: 0,
      allTimeTokens: 0,
      exactCalls: 0,
      estimatedCalls: 0,
      minuteCalls: 0,
      minuteTokens: 0,
      durationMs: 0,
      lastUsedAt: null,
      models: {},
      tasks: {}
    };
    usage.delete(budget.provider);
    const credentialNames = [
      ...(Array.isArray(budget.apiKeyEnvs) ? budget.apiKeyEnvs : []),
      budget.apiKeyEnv
    ].filter(Boolean);
    return {
      ...budget,
      ...current,
      credentialRequired: credentialNames.length > 0,
      credentialConfigured: credentialNames.length > 0
        ? secretsConfigured(credentialNames)
        : null
    };
  });

  return [
    ...configured,
    ...[...usage.values()].map((current) => ({
      id: current.provider,
      label: current.provider,
      class: "observed",
      autoUse: current.provider !== "codex",
      ...current
    }))
  ];
}

function modelBudgetUsage(telemetry, config) {
  const summaryModels = telemetry.summary?.models || {};
  const windowHours = Math.max(1, Number(config.telemetry?.budgetWindowHours || 24));
  const windowStart = Date.now() - windowHours * 60 * 60 * 1000;
  const configured = new Map((config.telemetry?.modelBudgets || []).map((entry) => [entry.model, entry]));
  const channelModels = [
    ...Object.values(config.routing || {}).map((model) => ({ model, provider: "ollama", class: "local" })),
    ...Object.values(config.workflowRoles || {}).map((role) => ({
      model: role.model,
      provider: role.provider || "unknown",
      class: role.class || "observed"
    })),
    ...[
      ...(config.escalation?.localChannels || []),
      ...(config.escalation?.channels || []),
      ...(config.escalation?.frontierChannels || [])
    ].map((channel) => ({
      model: channel.telemetryModel || channel.model,
      provider: channel.telemetryProvider || (channel.type === "ollama" ? "ollama" : channel.type),
      class: channel.type === "ollama" || channel.type === "hermes"
        ? "local"
        : channel.type === "codex"
          ? "paid-frontier"
          : channel.type === "openai-compatible" || channel.type === "copilot-cli"
            ? "free-tier"
            : "subscription"
    }))
  ].filter((entry) => entry.model);
  const metadata = new Map(channelModels.map((entry) => [entry.model, entry]));
  for (const [model, entry] of configured) metadata.set(model, { ...(metadata.get(model) || {}), ...entry });

  const daily = new Map();
  const observedProviders = new Map();
  for (const event of telemetry.events || []) {
    observedProviders.set(event.model, event.provider || "unknown");
    if (Date.parse(event.capturedAt) < windowStart) continue;
    const current = daily.get(event.model) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      exactCalls: 0,
      estimatedCalls: 0
    };
    current.calls += 1;
    current.promptTokens += event.usage?.promptTokens || 0;
    current.completionTokens += event.usage?.completionTokens || 0;
    current.totalTokens += event.usage?.totalTokens || 0;
    current[event.usage?.exact ? "exactCalls" : "estimatedCalls"] += 1;
    daily.set(event.model, current);
  }

  const models = new Set([...Object.keys(summaryModels), ...metadata.keys()]);
  return [...models].map((model) => {
    const totals = summaryModels[model] || {};
    const recent = daily.get(model) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      exactCalls: 0,
      estimatedCalls: 0
    };
    const settings = metadata.get(model) || {};
    const provider = settings.provider || observedProviders.get(model) || "unknown";
    const modelClass = settings.class || (provider === "ollama" ? "local" : "observed");
    const inputRate = Number.isFinite(settings.inputUsdPerMillion) ? settings.inputUsdPerMillion : null;
    const outputRate = Number.isFinite(settings.outputUsdPerMillion) ? settings.outputUsdPerMillion : null;
    const estimateCost = (usage) => inputRate === null || outputRate === null
      ? null
      : ((usage.promptTokens || 0) * inputRate + (usage.completionTokens || 0) * outputRate) / 1_000_000;
    return {
      model,
      provider,
      class: modelClass,
      unlimited: modelClass === "local",
      dailyTokenSoftCap: settings.dailyTokenSoftCap || null,
      dailyCostSoftCapUsd: settings.dailyCostSoftCapUsd || null,
      inputUsdPerMillion: inputRate,
      outputUsdPerMillion: outputRate,
      notes: settings.notes || null,
      totals: {
        calls: totals.calls || 0,
        promptTokens: totals.promptTokens || 0,
        completionTokens: totals.completionTokens || 0,
        totalTokens: totals.totalTokens || 0,
        exactCalls: totals.exactCalls || 0,
        estimatedCalls: totals.estimatedCalls || 0,
        completionTokensPerSecond: totals.completionTokensPerSecond || null,
        estimatedCostUsd: estimateCost(totals)
      },
      window: {
        hours: windowHours,
        ...recent,
        estimatedCostUsd: estimateCost(recent)
      }
    };
  }).sort((a, b) => b.window.totalTokens - a.window.totalTokens || b.totals.totalTokens - a.totals.totalTokens);
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
  const [state, tasks, workerConfig, bridgeState, loopSnapshot, gpuHandoff, telemetry, gitStatus] = await Promise.all([
    readJson(path.join(ROOT, "WORKER_STATE.json"), {}),
    extractTasks(),
    readJson(path.join(__dirname, "config.json"), {}),
    readJson(path.join(ROOT, "LOOPS", "loop-bridge-state.json"), {}),
    readJson(path.join(ROOT, "LOOPS", "edgeops-worker-loop.json"), null),
    readJson(path.join(ROOT, "LOOPS", "gpu-tool-handoff.json"), null),
    readTelemetry(RUNTIME_DIR, 5000),
    run("git", ["status", "--short"], 10000).catch((error) => error.output || error.message)
  ]);
  const serviceHealth = await Promise.all([
    health("http://127.0.0.1:3100/api/health"),
    health("http://127.0.0.1:11434/api/version"),
    openclawHealth(workerConfig),
    voiceboxHealth(),
    antigravityHealth(workerConfig),
    hermesHealth(workerConfig),
    colibriHealth(workerConfig),
    comfyHealth(workerConfig)
  ]);
  if (
    workerConfig.sharedGpuLease?.enabled === true
    && state.status === "running"
    && state.currentTaskId
  ) {
    serviceHealth[5] = {
      ok: true,
      status: "yielded",
      detail: `GPU yielded to project worker ${state.currentTaskId}`,
      body: serviceHealth[5].body || null
    };
  }

  const tokenTotals = taskTokenTotals(telemetry.events);
  const completedCount = tasks.filter((task) => state.taskStates?.[task.id]?.status === "completed").length;
  const frontierTokens = telemetry.events
    .filter((event) => event.provider === "codex")
    .reduce((sum, event) => sum + (event.usage?.totalTokens || 0), 0);
  const channelsById = new Map(publicRouting(workerConfig).availableChannels.map((channel) => [channel.id, channel]));
  const taskRows = await Promise.all(tasks.map(async (task) => {
    const taskState = state.taskStates?.[task.id] || {};
    const configuredChannel = channelsById.get(taskState.escalationChannel);
    const guidancePath = path.join(ROOT, "ESCALATIONS", "inbox", `${task.id}.md`);
    const [pendingGuidance, guidanceStat] = await Promise.all([
      fs.readFile(guidancePath, "utf8").catch(() => ""),
      fs.stat(guidancePath).catch(() => null)
    ]);
    const escalationJob = escalationJobs.get(task.id) || (pendingGuidance ? {
      taskId: task.id,
      channelId: taskState.escalationChannel || "approved",
      status: "completed",
      startedAt: null,
      finishedAt: guidanceStat?.mtime?.toISOString() || null,
      detail: "Guidance saved. The local worker will consume it on its next pass.",
      answerExcerpt: pendingGuidance.slice(0, 6000)
    } : null);
    const escalationHistory = await Promise.all(
      (Array.isArray(taskState.escalationHistory) ? taskState.escalationHistory : []).map(async (event) => {
        const answerPath = typeof event.answerPath === "string" ? path.resolve(event.answerPath) : "";
        const insideWorkspace = answerPath === ROOT || answerPath.startsWith(`${ROOT}${path.sep}`);
        const answerExcerpt = insideWorkspace
          ? (await fs.readFile(answerPath, "utf8").catch(() => "")).slice(0, 1800)
          : "";
        return { ...event, answerExcerpt };
      })
    );
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
      escalationAutoInvoke: configuredChannel?.autoInvoke === true,
      escalationRequestPath: taskState.escalationRequestPath || null,
      escalationAutoInvokeError: taskState.escalationAutoInvokeError || null,
      operatorPlanSource: taskState.operatorPlanSource || null,
      operatorPlanScope: taskState.operatorPlanScope || [],
      operatorPlanSkippedReason: taskState.operatorPlanSkippedReason || null,
      lastFailureFingerprint: taskState.lastFailureFingerprint || null,
      lastFailureFingerprintCount: taskState.lastFailureFingerprintCount || 0,
      difficulty: taskState.difficulty || null,
      difficultyScore: taskState.difficultyScore || 0,
      routingReason: taskState.routingReason || null,
      lastFailureClass: taskState.lastFailureClass || null,
      trajectoryAttempts: taskState.trajectoryAttempts || 0,
      runtimeRetries: taskState.runtimeRetries || 0,
      activity: taskState.activity || (state.activity?.taskId === task.id ? state.activity : null),
      preApprovalResearchStatus: taskState.preApprovalResearchStatus || null,
      preApprovalResearchPath: taskState.preApprovalResearchPath || null,
      hasEscalationGuidance: Boolean(taskState.escalationAnswer),
      retryContext: taskState.retryContext || null,
      escalationHistory,
      escalationJob,
      tokens: tokenTotals[task.id] || { calls: 0, totalTokens: 0, exactCalls: 0, estimatedCalls: 0 }
    };
  }));

  const secrets = secretStatus();
  const voiceHealth = serviceHealth[3].body || {};
  return {
    capturedAt: new Date().toISOString(),
    goal: {
      title: "Browser-native local AI analytics portfolio",
      objective: "Showcase a browser-hosted local language model that proposes validated analytics plans for bundled, public, and visitor-supplied data while remaining static and GitHub Pages compatible.",
      completedTasks: completedCount,
      totalTasks: tasks.length,
      progressPercent: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
      totalTokens: telemetry.summary?.totals?.totalTokens || 0,
      frontierTokens,
      currentMilestone: taskRows.find((task) => ["running", "awaiting_escalation"].includes(task.status))
        || taskRows.find((task) => task.status === "pending")
        || null
    },
    worker: {
      status: state.status || "unknown",
      currentTaskId: state.currentTaskId || null,
      lastHeartbeat: state.lastHeartbeat || null,
      lastError: state.lastError || null,
      pid: state.workerPid || null
    },
    tasks: taskRows,
    routing: publicRouting(workerConfig),
    policy: {
      maxRepairCycles: workerConfig.maxRepairCycles || 2,
      repeatedFailureLimit: workerConfig.escalation?.maxRepeatedFailureFingerprint || 2,
      frontierBudget: workerConfig.escalation?.frontierBudget || null,
      providerBudgets: providerBudgetUsage(
        telemetry.events,
        workerConfig.escalation?.providerBudgets || [],
        workerConfig.telemetry?.budgetWindowHours || 24
      ),
      modelBudgets: modelBudgetUsage(telemetry, workerConfig)
    },
    telemetry: { ...telemetry, events: telemetry.events.slice(0, 200) },
    paperclip: {
      issueId: bridgeState.paperclipIssueId || null,
      lastSyncedAt: bridgeState.lastSyncedAt || null,
      snapshotAt: loopSnapshot?.capturedAt || null
    },
    gpuHandoff: gpuHandoff || { version: 1, status: "idle", owner: null, nextStage: null },
    services: [
      { name: "Paperclip", url: "http://127.0.0.1:3100", ...serviceHealth[0] },
      { name: "Ollama", url: "http://127.0.0.1:11434", ...serviceHealth[1] },
      { name: "OpenClaw Mac", url: "ssh://openclaw-mac:18789", ...serviceHealth[2] },
      { name: "Voicebox", url: "http://127.0.0.1:8765", ...serviceHealth[3] },
      { name: "Antigravity", url: "local agy", ...serviceHealth[4] },
      { name: "Hermes", url: "http://127.0.0.1:18642", ...serviceHealth[5] },
      { name: "GLM 5.2 Colibri", url: "http://127.0.0.1:1236", ...serviceHealth[6] },
      { name: "ComfyUI", url: "http://127.0.0.1:8188", ...serviceHealth[7] }
    ],
    connections: Object.entries(CONNECTIONS).map(([id, connection]) => ({
      id,
      label: connection.label,
      detail: connection.detail,
      configured: secrets[connection.secretName]?.configured || false,
      source: secrets[connection.secretName]?.source || null,
      remoteTargets: connection.remoteTargets || []
    })),
    voice: [
      {
        id: "faster-whisper",
        label: "Local faster-whisper STT",
        kind: "STT",
        status: voiceHealth.stt?.status || "unknown",
        configured: true,
        model: voiceHealth.stt?.model || "loads on first request",
        allowance: "Unlimited local inference"
      },
      {
        id: "voicebox",
        label: "Local Voicebox TTS",
        kind: "TTS",
        status: voiceHealth.tts?.provider === "voicebox" ? voiceHealth.tts.status : "standby",
        configured: voiceHealth.tts?.configured === true,
        model: voiceHealth.tts?.backend || "Qwen voice runtime",
        allowance: "Unlimited local inference"
      },
      {
        id: "gemini-tts",
        label: "Gemini Flash TTS",
        kind: "TTS",
        status: secrets.GOOGLE_API_KEY?.configured ? "ready" : "setup",
        configured: secrets.GOOGLE_API_KEY?.configured || false,
        model: "gemini-3.1-flash-tts-preview",
        allowance: "Free-tier allowlist enforced by the voice gateway",
        detail: "Already selectable per request through the live voice gateway."
      },
      {
        id: "gemini-live",
        label: "Gemini Live voice",
        kind: "STT + TTS",
        status: secrets.GOOGLE_API_KEY?.configured ? "available" : "setup",
        configured: secrets.GOOGLE_API_KEY?.configured || false,
        model: "Gemini native audio",
        allowance: "Account and model-specific AI Studio limits",
        detail: "Available for a future low-latency streaming adapter."
      },
      {
        id: "elevenlabs",
        label: "ElevenLabs voice",
        kind: "STT + TTS",
        status: secrets.ELEVENLABS_API_KEY?.configured ? "available" : "setup",
        configured: secrets.ELEVENLABS_API_KEY?.configured || false,
        model: "Multilingual v2 TTS / Scribe v2 STT",
        allowance: "Account credit and plan limits",
        detail: "Opt-in OpenClaw provider; local voice remains the default."
      },
      {
        id: "resemble",
        label: "Resemble AI cloud voice",
        kind: "TTS",
        status: secrets.RESEMBLE_API_KEY?.configured ? "available" : "setup",
        configured: secrets.RESEMBLE_API_KEY?.configured || false,
        model: "Resemble Cloud API",
        allowance: "Account credit and plan limits",
        detail: "A Resemble API key enables cloud speech. DramaBox is a separate local open-source model."
      },
      {
        id: "google-cloud-stt",
        label: "Google Cloud Speech-to-Text V1",
        kind: "STT",
        status: process.env.GOOGLE_APPLICATION_CREDENTIALS ? "available" : "setup",
        configured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        model: "Cloud STT V1",
        allowance: "First 60 minutes each month at no charge"
      },
      {
        id: "google-cloud-tts",
        label: "Google Cloud Text-to-Speech",
        kind: "TTS",
        status: process.env.GOOGLE_APPLICATION_CREDENTIALS ? "available" : "setup",
        configured: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
        model: "WaveNet / Standard / Chirp 3 HD",
        allowance: "Free character allowance varies by voice family"
      }
    ],
    git: { dirty: Boolean(gitStatus.trim()), status: gitStatus.slice(0, 12000) }
  };
}

async function readBody(request, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function assertLocalMutation(request) {
  const host = request.headers.host || "";
  const origin = request.headers.origin;
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  const remoteAddress = request.socket.remoteAddress || "";
  const loopbackProxy = remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1";
  const trustedHost = hostname === "127.0.0.1"
    || hostname === "localhost"
    || (loopbackProxy && hostname.endsWith(".ts.net"));
  if (!trustedHost) {
    throw new Error("Control plane mutations require loopback or the local Tailscale proxy.");
  }
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new Error("Invalid control request origin.");
    }
    if (originHost !== host.toLowerCase()) throw new Error("Cross-origin control request rejected.");
  }
}

async function runControl(action) {
  if (action === "start-comfyui" || action === "yield-gpu-start-comfyui") {
    return JSON.stringify(await canonicalComfyControl.start({
      makeRoom: action === "yield-gpu-start-comfyui"
    }));
  }
  const controls = {
    start: { script: "start-worker.ps1" },
    pause: { script: "pause-worker.ps1" },
    resume: { script: "resume-worker.ps1" },
    stop: { script: "stop-worker.ps1" },
    sync: { script: "sync-loop-once.ps1" }
  };
  const control = controls[action];
  if (!control) throw new Error(`Unknown control action: ${action}`);
  return run(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, control.script), ...(control.args || [])],
    control.timeout || 30000
  );
}

function runWithInput(command, args, input, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Remote secret synchronization failed with exit ${code}: ${stderr.slice(-500)}`));
    });
    child.stdin.end(input);
  });
}

async function syncSecretToMacEnv(targetId, name, value) {
  const target = REMOTE_ENV_TARGETS[targetId];
  if (!target) throw new Error(`Unknown remote environment target: ${targetId}`);
  const script = [
    "import os, pathlib, sys, tempfile",
    "name = sys.argv[1]",
    "relative = sys.argv[2]",
    "value = sys.stdin.read().strip()",
    "target = pathlib.Path.home() / relative",
    "target.parent.mkdir(parents=True, exist_ok=True)",
    "lines = target.read_text().splitlines() if target.exists() else []",
    "prefix = name + '='",
    "lines = [line for line in lines if not line.startswith(prefix)]",
    "lines.append(prefix + value) if value else None",
    "fd, temp = tempfile.mkstemp(prefix='.env.', dir=str(target.parent), text=True)",
    "os.close(fd)",
    "pathlib.Path(temp).write_text('\\n'.join(lines) + '\\n')",
    "os.chmod(temp, 0o600)",
    "os.replace(temp, target)"
  ].join("; ");
  await runWithInput(
    "ssh",
    [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=8",
      "-F", SSH_CONFIG_PATH,
      "openclaw-mac",
      `python3 -c '${script.replaceAll("'", "'\\''")}' ${name} ${target.envPath}`
    ],
    value,
    20000
  );
}

async function refreshMacTarget(targetId) {
  const command = REMOTE_ENV_TARGETS[targetId]?.refreshCommand;
  if (!command) return;
  await run(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-F", SSH_CONFIG_PATH, "openclaw-mac", command],
    20000
  );
}

async function updateConnection(body) {
  const id = String(body.id || "").trim();
  const connection = CONNECTIONS[id];
  if (!connection) throw new Error("Unknown provider connection.");
  const value = String(body.secret || "").trim();
  await setStoredSecret(connection.secretName, value);
  const remoteTargets = connection.remoteTargets || [];
  const syncedTargets = [];
  try {
    for (const target of remoteTargets) {
      await syncSecretToMacEnv(target, connection.secretName, value);
      syncedTargets.push(target);
    }
  } catch (error) {
    await deleteStoredSecret(connection.secretName);
    await Promise.allSettled(
      syncedTargets.map((target) => syncSecretToMacEnv(target, connection.secretName, ""))
    );
    throw error;
  }
  const refreshWarnings = [];
  for (const target of syncedTargets) {
    try {
      await refreshMacTarget(target);
    } catch (error) {
      refreshWarnings.push(`${target}: ${error.message}`);
    }
  }
  return {
    id,
    configured: true,
    source: "local-store",
    remoteSynced: syncedTargets,
    refreshWarnings
  };
}

async function removeConnection(body) {
  const id = String(body.id || "").trim();
  const connection = CONNECTIONS[id];
  if (!connection) throw new Error("Unknown provider connection.");
  await deleteStoredSecret(connection.secretName);
  for (const target of connection.remoteTargets || []) {
    await syncSecretToMacEnv(target, connection.secretName, "");
    await refreshMacTarget(target);
  }
  return { id, configured: Boolean(process.env[connection.secretName]) };
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
    ...(config.escalation?.channels || []),
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

async function approveEscalation(body) {
  const taskId = String(body.taskId || "").trim();
  const channelId = String(body.channelId || "").trim();
  if (!/^[A-Za-z0-9_.:-]+$/.test(taskId)) throw new Error("A valid taskId is required.");
  if (!/^[A-Za-z0-9_.:-]+$/.test(channelId)) throw new Error("A valid channelId is required.");
  const existing = escalationJobs.get(taskId);
  if (existing?.status === "running") return existing;

  const job = {
    taskId,
    channelId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    detail: "Approved escalation is running."
  };
  escalationJobs.set(taskId, job);

  const child = spawn(
    process.execPath,
    ["worker/qwen-worker.mjs", "--escalate", taskId, "--channel", channelId],
    { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  const capture = (chunk) => {
    output = `${output}${chunk}`.slice(-12000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    escalationJobs.set(taskId, {
      ...job,
      status: "failed",
      finishedAt: new Date().toISOString(),
      detail: String(error.message || error).slice(0, 1000)
    });
  });
  child.once("close", async (code) => {
    let answerExcerpt = "";
    if (code === 0) {
      answerExcerpt = await fs.readFile(
        path.join(ROOT, "ESCALATIONS", "inbox", `${taskId}.md`),
        "utf8"
      ).then((value) => value.slice(0, 6000)).catch(() => "");
    }
    escalationJobs.set(taskId, {
      ...job,
      status: code === 0 ? "completed" : "failed",
      finishedAt: new Date().toISOString(),
      answerExcerpt,
      detail: code === 0
        ? "Guidance saved. The local worker will consume it on its next pass."
        : (output.trim() || `Escalation exited with code ${code}.`).slice(-2000)
    });
  });
  return job;
}

async function retryLocalTask(body) {
  const taskId = String(body.taskId || "").trim();
  if (!/^[A-Za-z0-9_.:-]+$/.test(taskId)) throw new Error("A valid taskId is required.");
  const output = await run(
    process.execPath,
    ["worker/qwen-worker.mjs", "--retry-local", taskId],
    30000
  );
  return { taskId, detail: output.trim() };
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
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
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
    "content-security-policy": "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src https://desktop-6he0t2k.taile5e8da.ts.net:8443 https://macbook-pro-4.taile5e8da.ts.net; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  if (normalized === "index.html") {
    const html = await fs.readFile(filePath, "utf8");
    response.end(edgeOpsBrowserSessions.injectHtml(html, { bootstrapId: url.searchParams.get("bootstrap") }));
    return;
  }
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, await collectStatus());
    }
    if (request.method === "GET" && url.pathname === "/api/agentic-os/status") {
      return sendJson(response, 200, await agenticOsProxy.status());
    }
    if (request.method === "POST" && url.pathname === "/api/agentic-os/browser-sessions") {
      const capability = await edgeOpsCapabilityPromise;
      assertExactLocalMutation(request, {
        authorized: requestHasEdgeOpsControlCapability(request, capability)
      });
      await readBody(request, AGENTIC_OS_BODY_BYTES);
      return sendJson(response, 201, edgeOpsBrowserSessions.issueBootstrap());
    }
    if (request.method === "POST" && url.pathname === "/api/agentic-os/preemption-grants") {
      const capability = await edgeOpsCapabilityPromise;
      assertExactLocalMutation(request, {
        authorized: edgeOpsBrowserSessions.authorizes(request)
          || requestHasEdgeOpsControlCapability(request, capability)
      });
      const body = await readBody(request, AGENTIC_OS_BODY_BYTES);
      return sendJson(response, 201, await agenticOsProxy.preemptionGrant(body));
    }
    if (request.method === "POST" && url.pathname === "/api/agentic-os/reconcile") {
      const capability = await edgeOpsCapabilityPromise;
      assertExactLocalMutation(request, {
        authorized: edgeOpsBrowserSessions.authorizes(request)
          || requestHasEdgeOpsControlCapability(request, capability)
      });
      const body = await readBody(request, AGENTIC_OS_BODY_BYTES);
      return sendJson(response, 200, await agenticOsProxy.reconcile(body));
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
    if (request.method === "POST" && url.pathname === "/api/escalation/approve") {
      assertLocalMutation(request);
      const body = await readBody(request);
      return sendJson(response, 200, { ok: true, output: await approveEscalation(body) });
    }
    if (request.method === "POST" && url.pathname === "/api/escalation/retry-local") {
      assertLocalMutation(request);
      const body = await readBody(request);
      return sendJson(response, 200, { ok: true, output: await retryLocalTask(body) });
    }
    if (request.method === "POST" && url.pathname === "/api/operator-context") {
      assertLocalMutation(request);
      const body = await readBody(request);
      await updateOperatorContext(body);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/connections") {
      assertLocalMutation(request);
      const body = await readBody(request);
      return sendJson(response, 200, { ok: true, connection: await updateConnection(body) });
    }
    if (request.method === "DELETE" && url.pathname === "/api/connections") {
      assertLocalMutation(request);
      const body = await readBody(request);
      return sendJson(response, 200, { ok: true, connection: await removeConnection(body) });
    }
    return serveStatic(request, response);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      operation: "control-plane-request",
      method: request.method,
      path: String(request.url || "").split("?", 1)[0].slice(0, 300),
      errorType: error.name,
      message: String(error.message || "Unknown request error").slice(0, 1000)
    }));
    const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 400;
    return sendJson(response, status, { error: String(error.message || "Request failed").slice(0, 1000) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EdgeOps Control Plane listening on http://${HOST}:${PORT}`);
});
