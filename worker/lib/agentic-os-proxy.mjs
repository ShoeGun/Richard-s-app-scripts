import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export const AGENTIC_OS_STATUS_URL = "http://127.0.0.1:3220/api/system/status";
export const AGENTIC_OS_RECONCILE_URL = "http://127.0.0.1:3220/api/system/reconcile";
export const AGENTIC_OS_PREEMPTION_GRANT_URL = "http://127.0.0.1:3220/api/system/preemption-grants";
export const AGENTIC_OS_BOOTSTRAP_SCRIPT = "C:\\Users\\Richard\\Projects\\edgeops-agent-studio\\scripts\\start-agentic-os.ps1";
export const AGENTIC_OS_CAPABILITY_PATH = "C:\\Users\\Richard\\AppData\\Local\\AgenticOS\\control.capability";

const POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const REQUEST_TIMEOUT_MS = 15_000;
const BOOTSTRAP_TIMEOUT_MS = 1_900_000;
const MAX_CONTROLLER_RESPONSE_BYTES = 1024 * 1024;
const ALLOWED_MODES = new Set(["autonomous", "gpu-focus"]);

export class AgenticOsProxyError extends Error {
  constructor(message, { statusCode = 503, controllerReachable = false } = {}) {
    super(message);
    this.name = "AgenticOsProxyError";
    this.statusCode = statusCode;
    this.controllerReachable = controllerReachable;
  }
}

function runBootstrapScript(scriptPath) {
  if (scriptPath !== AGENTIC_OS_BOOTSTRAP_SCRIPT) {
    throw new AgenticOsProxyError("Agentic OS bootstrap path failed its fixed-path check.");
  }
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL_EXE,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", AGENTIC_OS_BOOTSTRAP_SCRIPT],
      {
        windowsHide: true,
        timeout: BOOTSTRAP_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      },
      (error) => {
        if (error) {
          const detail = error.killed
            ? "timed out"
            : error.code !== undefined
              ? `exit ${error.code}`
              : error.name;
          reject(new AgenticOsProxyError(`Agentic OS bootstrap failed (${detail}).`));
          return;
        }
        resolve();
      }
    );
  });
}

function validateReconcileInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgenticOsProxyError("Reconcile request must be a JSON object.", { statusCode: 400, controllerReachable: true });
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !["desiredMode", "expectedRevision", "preemptionGrantId"].includes(key))) {
    throw new AgenticOsProxyError(
      "Reconcile request may contain only desiredMode, expectedRevision, and preemptionGrantId.",
      { statusCode: 400, controllerReachable: true }
    );
  }
  if (!ALLOWED_MODES.has(input.desiredMode)) {
    throw new AgenticOsProxyError(
      "desiredMode must be autonomous or gpu-focus.",
      { statusCode: 400, controllerReachable: true }
    );
  }
  if (
    input.expectedRevision !== undefined
    && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
  ) {
    throw new AgenticOsProxyError(
      "expectedRevision must be a non-negative safe integer.",
      { statusCode: 400, controllerReachable: true }
    );
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(input.preemptionGrantId || "")) {
    throw new AgenticOsProxyError(
      "preemptionGrantId must be the exact short-lived controller grant.",
      { statusCode: 400, controllerReachable: true }
    );
  }
}

function validatePreemptionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => key !== "desiredMode")
      || !ALLOWED_MODES.has(input.desiredMode)) {
    throw new AgenticOsProxyError(
      "Preemption grant request requires only desiredMode autonomous or gpu-focus.",
      { statusCode: 400, controllerReachable: true }
    );
  }
}

async function readControlCapability() {
  const facts = await lstat(AGENTIC_OS_CAPABILITY_PATH);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.size > 256) throw new Error("invalid capability file");
  const value = (await readFile(AGENTIC_OS_CAPABILITY_PATH, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new Error("invalid capability value");
  return value;
}

async function controllerJson(fetchImpl, url, options, capability = null) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(capability ? { "x-agentic-os-capability": capability } : {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new AgenticOsProxyError(
      `Agentic OS controller is unavailable: ${error?.name || "network error"}`,
      { controllerReachable: false }
    );
  }

  let text;
  try {
    const declaredLength = Number(response.headers?.get?.("content-length") || 0);
    if (declaredLength > MAX_CONTROLLER_RESPONSE_BYTES) {
      throw new Error("response is too large");
    }
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CONTROLLER_RESPONSE_BYTES) {
          await reader.cancel("response is too large").catch(() => {});
          throw new Error("response is too large");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_CONTROLLER_RESPONSE_BYTES) {
        throw new Error("response is too large");
      }
    }
  } catch (error) {
    throw new AgenticOsProxyError(
      `Agentic OS controller returned an unreadable response: ${error.message}`,
      { controllerReachable: true }
    );
  }

  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    throw new AgenticOsProxyError("Agentic OS controller returned invalid JSON.", { controllerReachable: true });
  }
  if (!response.ok) {
    const upstreamMessage = typeof body?.error === "string" ? body.error.slice(0, 800) : `HTTP ${response.status}`;
    throw new AgenticOsProxyError(`Agentic OS request failed: ${upstreamMessage}`, {
      statusCode: response.status,
      controllerReachable: true
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AgenticOsProxyError("Agentic OS controller returned an invalid receipt.", { controllerReachable: true });
  }
  return body;
}

function annotate(value, bootstrapped) {
  return {
    ...value,
    proxy: {
      ...(value.proxy && typeof value.proxy === "object" ? value.proxy : {}),
      bootstrapped,
      controller: "127.0.0.1:3220"
    }
  };
}

export function createAgenticOsProxy({
  fetchImpl = globalThis.fetch,
  runBootstrap = runBootstrapScript,
  readCapability = readControlCapability,
  makeCommandId = () => `3210-${randomUUID()}`
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  if (typeof runBootstrap !== "function") throw new TypeError("runBootstrap must be a function.");
  if (typeof readCapability !== "function") throw new TypeError("readCapability must be a function.");

  let bootstrapInFlight = null;
  const ensureController = async () => {
    if (!bootstrapInFlight) {
      bootstrapInFlight = Promise.resolve()
        .then(() => runBootstrap(AGENTIC_OS_BOOTSTRAP_SCRIPT))
        .finally(() => { bootstrapInFlight = null; });
    }
    return bootstrapInFlight;
  };

  const requestWithBootstrapRetry = async (operation) => {
    try {
      return annotate(await operation(), false);
    } catch (error) {
      if (!(error instanceof AgenticOsProxyError) || error.controllerReachable !== false) throw error;
      await ensureController();
      return annotate(await operation(), true);
    }
  };

  return Object.freeze({
    status() {
      return requestWithBootstrapRetry(() => controllerJson(fetchImpl, AGENTIC_OS_STATUS_URL, { method: "GET" }));
    },
    async preemptionGrant(input) {
      validatePreemptionInput(input);
      const body = JSON.stringify(input);
      return requestWithBootstrapRetry(async () => {
        let capability;
        try {
          capability = await readCapability();
        } catch {
          throw new AgenticOsProxyError("Agentic OS control capability is unavailable.", { controllerReachable: true });
        }
        return controllerJson(fetchImpl, AGENTIC_OS_PREEMPTION_GRANT_URL, { method: "POST", body }, capability);
      });
    },
    async reconcile(input) {
      validateReconcileInput(input);
      const command = {
        commandId: makeCommandId(),
        desiredMode: input.desiredMode,
        ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
        preemptionGrantId: input.preemptionGrantId
      };
      const body = JSON.stringify(command);
      if (Buffer.byteLength(body, "utf8") > 512) {
        throw new AgenticOsProxyError("Reconcile request exceeds the fixed request budget.", {
          statusCode: 400,
          controllerReachable: true
        });
      }
      return requestWithBootstrapRetry(async () => {
        let capability;
        try {
          capability = await readCapability();
        } catch {
          throw new AgenticOsProxyError("Agentic OS control capability is unavailable.", { controllerReachable: true });
        }
        return controllerJson(fetchImpl, AGENTIC_OS_RECONCILE_URL, { method: "POST", body }, capability);
      });
    }
  });
}
