import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(TEST_DIR, "..", "dashboard");
const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
];

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

test("real browser can reconcile GPU focus and render the canonical receipt", { timeout: 30_000 }, async (context) => {
  if (process.env.AGENTIC_OS_BROWSER_TEST !== "1") {
    return context.skip("Set AGENTIC_OS_BROWSER_TEST=1 for the real-browser harness.");
  }
  const browser = BROWSER_CANDIDATES.find(existsSync);
  if (!browser) return context.skip("No supported headless browser is installed.");

  const browserSession = "s".repeat(43);
  const grantId = "g".repeat(43);
  let receivedMutation = null;
  let receivedGrantRequest = null;
  const controlScript = await fs.readFile(path.join(DASHBOARD_DIR, "agentic-os-controls.js"), "utf8");
  const controlStyles = await fs.readFile(path.join(DASHBOARD_DIR, "agentic-os-controls.css"), "utf8");
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      return send(response, 200, `<!doctype html><html><head><meta name="edgeops-browser-session" content="${browserSession}"><link rel="stylesheet" href="/agentic-os-controls.css"><script>window.confirm=()=>true;</script></head><body><main></main><script type="module" src="/agentic-os-controls.js"></script><script type="module" src="/harness.js"></script></body></html>`, "text/html; charset=utf-8");
    }
    if (request.method === "GET" && request.url === "/agentic-os-controls.js") {
      return send(response, 200, controlScript, "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && request.url === "/agentic-os-controls.css") {
      return send(response, 200, controlStyles, "text/css; charset=utf-8");
    }
    if (request.method === "GET" && request.url === "/harness.js") {
      return send(response, 200, `const wait = (condition) => new Promise((resolve, reject) => { const started = Date.now(); const timer = setInterval(() => { if (condition()) { clearInterval(timer); resolve(); } else if (Date.now() - started > 3000) { clearInterval(timer); reject(new Error("controls did not mount")); } }, 20); }); await wait(() => document.querySelector("[data-agentic-gpu]") && document.querySelector("[data-agentic-summary]").textContent.includes("healthy")); document.querySelector("[data-agentic-gpu]").click(); await wait(() => document.querySelector("[data-agentic-gpu]").textContent === "Resume Agentic AI"); document.body.dataset.harness = "complete";`, "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && request.url === "/api/agentic-os/status") {
      return send(response, 200, JSON.stringify({
        version: 1,
        revision: 5,
        desiredMode: "autonomous",
        status: "completed",
        outcome: "healthy",
        components: [{ componentId: "paperclip", label: "Paperclip", desiredMode: "autonomous", outcome: "unchanged", state: {}, actions: [], observation: { detail: "ready" }, at: new Date().toISOString() }]
      }), "application/json; charset=utf-8");
    }
    if (request.method === "POST" && request.url === "/api/agentic-os/preemption-grants") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      receivedGrantRequest = {
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        browserSession: request.headers["x-edgeops-browser-session"]
      };
      return send(response, 201, JSON.stringify({ grantId, systemRevision: 5, confirmation: "Release exact idle generation for GPU focus?" }), "application/json; charset=utf-8");
    }
    if (request.method === "POST" && request.url === "/api/agentic-os/reconcile") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      receivedMutation = {
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        browserSession: request.headers["x-edgeops-browser-session"]
      };
      return send(response, 200, JSON.stringify({
        receiptId: "receipt-browser-smoke",
        commandId: "server-generated",
        fingerprint: "browser-smoke",
        revision: 6,
        desiredMode: "gpu-focus",
        outcome: "healthy",
        status: "completed",
        at: new Date().toISOString(),
        components: [{ componentId: "gpu", label: "GPU", desiredMode: "gpu-focus", outcome: "reconciled", state: {}, actions: ["pause"], observation: { detail: "released" }, at: new Date().toISOString() }]
      }), "application/json; charset=utf-8");
    }
    return send(response, 404, "not found", "text/plain; charset=utf-8");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-os-browser-"));
  try {
    const { stdout } = await execFileAsync(browser, [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-features=UseSkiaRenderer,WebGPU,Vulkan",
      "--no-first-run",
      "--no-proxy-server",
      "--virtual-time-budget=5000",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      `http://127.0.0.1:${address.port}/`
    ], { timeout: 20_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });

    assert.deepEqual(receivedGrantRequest, {
      body: { desiredMode: "gpu-focus" },
      browserSession
    });
    assert.deepEqual(receivedMutation, {
      body: { desiredMode: "gpu-focus", expectedRevision: 5, preemptionGrantId: grantId },
      browserSession
    });
    assert.match(stdout, /data-harness="complete"/);
    assert.match(stdout, /Resume Agentic AI/);
    assert.match(stdout, /GPU/);
    assert.match(stdout, /reconciled/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
});
