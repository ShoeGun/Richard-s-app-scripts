import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BRIDGE_PATH = path.join(ROOT, "config", "glm52-tool-bridge.json");
const WORKER_CONFIG_PATH = path.join(ROOT, "worker", "config.json");
const LOCK_PATH = path.join(ROOT, ".worker-control", "glm52-mcp-broker.lock");
const ARTIFACT_DIR = path.join(ROOT, ".worker-control", "mcp-artifacts");

const args = process.argv.slice(2);
const valueFor = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const serviceName = valueFor("--service");
const operation = valueFor("--operation", "status");
const method = valueFor("--method", operation === "mcp" ? "POST" : "GET").toUpperCase();
const requestPath = valueFor("--path");
const bodyText = valueFor("--body-json");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function serviceUrl(service, fallback) {
  const raw = service.endpoint || fallback;
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(`Refusing non-loopback tool endpoint: ${url.hostname}`);
  }
  return url;
}

async function acquireLock() {
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  try {
    await fs.writeFile(LOCK_PATH, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { flag: "wx" });
  } catch {
    throw new Error("Another GLM tool call is active; retry after it records its result.");
  }
}

async function recordArtifact(result) {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const filePath = path.join(ARTIFACT_DIR, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${serviceName}-${operation}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* preserve non-JSON tool output */ }
  if (!response.ok) throw new Error(`Tool endpoint returned HTTP ${response.status}: ${String(text).slice(0, 500)}`);
  return { status: response.status, body };
}

function runPowerShell(script, scriptArgs = []) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, script), ...scriptArgs], {
      cwd: ROOT,
      windowsHide: true,
      timeout: 150000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${stdout}${stderr}`.trim() || error.message));
      else resolve(`${stdout}${stderr}`.trim());
    });
  });
}

async function run() {
  if (!serviceName || !["comfyui", "unreal"].includes(serviceName)) {
    throw new Error("Use --service comfyui or --service unreal.");
  }
  const bridge = await readJson(BRIDGE_PATH);
  const worker = await readJson(WORKER_CONFIG_PATH);
  const configured = bridge.mcpServers?.[serviceName] || {};
  const managed = worker.managedServices?.[serviceName] || {};
  await acquireLock();
  try {
    if (serviceName === "comfyui" && ["start", "yield-start", "stop"].includes(operation)) {
      const output = operation === "stop"
        ? await runPowerShell(managed.stopScript || "scripts/stop-comfyui.ps1")
        : await runPowerShell(managed.startScript || "scripts/start-comfyui.ps1", operation === "yield-start"
          ? ["-WaitForGpu", "-StopRegisteredGpuOwners", "-TimeoutSeconds", "120"]
          : []);
      return { service: serviceName, operation, output };
    }

    const endpoint = serviceName === "comfyui"
      ? serviceUrl(managed, "http://127.0.0.1:8188")
      : serviceUrl({ endpoint: configured.endpoint }, "http://127.0.0.1:8000");
    const healthEndpoint = serviceName === "unreal"
      ? serviceUrl({ endpoint: configured.healthEndpoint }, "http://127.0.0.1:30010")
      : endpoint;
    const target = requestPath || (operation === "status"
      ? (configured.healthPath || (serviceName === "unreal" ? "/remote/info" : managed.healthUrl?.replace(endpoint.origin, "") || "/"))
      : serviceName === "comfyui" && operation === "queue" ? "/queue" : "/mcp");
    const url = new URL(target, operation === "status" ? healthEndpoint : endpoint);
    const init = { method, headers: { accept: "application/json", "content-type": "application/json" } };
    if (bodyText) init.body = bodyText;
    const result = await request(url, init);
    return { service: serviceName, operation, method, url: url.toString(), result };
  } finally {
    await fs.rm(LOCK_PATH, { force: true });
  }
}

try {
  const result = await run();
  const artifactPath = await recordArtifact({ ok: true, ...result });
  process.stdout.write(`${JSON.stringify({ ok: true, ...result, artifactPath })}\n`);
} catch (error) {
  const result = { ok: false, service: serviceName, operation, error: error.message };
  const artifactPath = await recordArtifact(result).catch(() => null);
  process.stderr.write(`${JSON.stringify({ ...result, artifactPath })}\n`);
  process.exitCode = 1;
}
