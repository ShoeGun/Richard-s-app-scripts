import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import { mountAgenticOsControls } from "../dashboard/agentic-os-controls.js";

const BROWSER_SESSION = "s".repeat(43);
const GRANT_ID = "g".repeat(43);

function authorizedDom(markup = "<main></main>") {
  return new JSDOM(`<!doctype html><html><head><meta name="edgeops-browser-session" content="${BROWSER_SESSION}"></head><body>${markup}</body></html>`, {
    url: "http://127.0.0.1:3210/?bootstrap=bootstrap-was-consumed"
  });
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("renders prominent online and GPU focus controls with component receipts", async () => {
  const dom = new JSDOM("<!doctype html><main><nav class=\"tabs\"></nav></main>");
  const calls = [];
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({
        revision: 12,
        desiredMode: "autonomous",
        outcome: "degraded",
        status: "completed",
        components: [
          { componentId: "paperclip", label: "Paperclip", outcome: "unchanged", observation: { detail: "Listening on 3100" }, actions: [] },
          { componentId: "openclaw", label: "OpenClaw", outcome: "degraded", error: { message: "Gateway unavailable" }, actions: ["start"] }
        ]
      });
    }
  });
  await controls.ready;

  const panel = dom.window.document.querySelector("[data-agentic-os-controls]");
  assert.ok(panel);
  assert.equal(panel.querySelector("[data-agentic-online]").textContent, "Bring Agentic OS Online");
  assert.equal(panel.querySelector("[data-agentic-gpu]").textContent, "Pause local AI for GPU");
  assert.match(panel.querySelector("[data-agentic-summary]").textContent, /degraded/i);
  assert.match(panel.querySelector("[data-agentic-components]").textContent, /Paperclip.*unchanged/s);
  assert.match(panel.querySelector("[data-agentic-blockers]").textContent, /OpenClaw.*Gateway unavailable/s);
  assert.equal(calls[0].url, "/api/agentic-os/status");
  assert.equal(panel.querySelector("[data-agentic-online]").disabled, true);
  assert.equal(panel.querySelector("[data-agentic-gpu]").disabled, true);
  controls.destroy();
});

test("GPU control confirms a server grant and sends its exact id with the fixed mode and revision", async () => {
  const dom = authorizedDom();
  const calls = [];
  const confirmations = [];
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    confirmImpl(message) {
      confirmations.push(message);
      return true;
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "/api/agentic-os/preemption-grants") {
        return response({ grantId: GRANT_ID, systemRevision: 21, confirmation: "Release exact idle generation for GPU focus?" }, 201);
      }
      if (url === "/api/agentic-os/reconcile") {
        return response({
          revision: 22,
          desiredMode: "gpu-focus",
          outcome: "healthy",
          status: "completed",
          components: [{ componentId: "gpu", label: "GPU", outcome: "reconciled", observation: { detail: "Local AI paused" }, actions: ["pause"] }]
        });
      }
      return response({ revision: 20, desiredMode: "autonomous", outcome: "healthy", status: "completed", components: [] });
    }
  });
  await controls.ready;

  const button = dom.window.document.querySelector("[data-agentic-gpu]");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const mutations = calls.filter((call) => call.options.method === "POST");
  assert.deepEqual(mutations.map((call) => call.url), [
    "/api/agentic-os/preemption-grants",
    "/api/agentic-os/reconcile"
  ]);
  assert.deepEqual(JSON.parse(mutations[0].options.body), { desiredMode: "gpu-focus" });
  assert.deepEqual(JSON.parse(mutations[1].options.body), {
    desiredMode: "gpu-focus",
    expectedRevision: 21,
    preemptionGrantId: GRANT_ID
  });
  assert.ok(mutations.every((call) => call.options.headers["x-edgeops-browser-session"] === BROWSER_SESSION));
  assert.deepEqual(confirmations, ["Release exact idle generation for GPU focus?"]);
  assert.equal(dom.window.location.search, "");
  assert.equal(button.textContent, "Resume Agentic AI");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.match(dom.window.document.querySelector("[data-agentic-components]").textContent, /GPU.*reconciled/s);
  controls.destroy();
});

test("online control shows a degraded error instead of hiding a failed request", async () => {
  const dom = authorizedDom();
  let post = false;
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    confirmImpl: () => true,
    fetchImpl: async (url, options = {}) => {
      if (options.method === "POST") {
        post = true;
        if (url === "/api/agentic-os/preemption-grants") {
          return response({ grantId: GRANT_ID, systemRevision: 2, confirmation: "Resume the exact registered generation?" }, 201);
        }
        return response({ error: "Paperclip did not become ready" }, 503);
      }
      return response({ revision: 2, desiredMode: "gpu-focus", outcome: "healthy", status: "completed", components: [] });
    }
  });
  await controls.ready;

  dom.window.document.querySelector("[data-agentic-online]").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(post, true);
  assert.match(dom.window.document.querySelector("[data-agentic-summary]").textContent, /Paperclip did not become ready/);
  assert.equal(dom.window.document.querySelector("[data-agentic-panel]").dataset.state, "degraded");
  controls.destroy();
});

test("a slow status poll cannot overwrite a newer reconcile receipt", async () => {
  const dom = authorizedDom();
  let resolveStatus;
  const slowStatus = new Promise((resolve) => { resolveStatus = resolve; });
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    confirmImpl: () => true,
    fetchImpl: async (url, options = {}) => {
      if (options.method === "POST") {
        if (url === "/api/agentic-os/preemption-grants") {
          return response({ grantId: GRANT_ID, systemRevision: 1, confirmation: "Release the exact generation?" }, 201);
        }
        return response({
          revision: 2,
          desiredMode: "gpu-focus",
          outcome: "healthy",
          status: "completed",
          components: []
        });
      }
      return slowStatus;
    }
  });

  dom.window.document.querySelector("[data-agentic-gpu]").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector("[data-agentic-gpu]").textContent, "Resume Agentic AI");

  resolveStatus(response({
    revision: 1,
    desiredMode: "autonomous",
    outcome: "healthy",
    status: "completed",
    components: []
  }));
  await controls.ready;
  assert.equal(dom.window.document.querySelector("[data-agentic-gpu]").textContent, "Resume Agentic AI");
  controls.destroy();
});

test("direct dashboard navigation stays read-only and never sends a privileged mutation", async () => {
  const dom = new JSDOM("<!doctype html><main></main>", { url: "http://127.0.0.1:3210/" });
  const calls = [];
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({ revision: 1, desiredMode: "autonomous", outcome: "healthy", status: "completed", components: [] });
    }
  });
  await controls.ready;

  const button = dom.window.document.querySelector("[data-agentic-gpu]");
  assert.equal(button.disabled, true);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 0);
  controls.destroy();
});

test("declining the server-authored confirmation consumes no reconcile action", async () => {
  const dom = authorizedDom();
  const calls = [];
  const controls = mountAgenticOsControls({
    document: dom.window.document,
    pollMs: 0,
    confirmImpl: () => false,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "/api/agentic-os/preemption-grants") {
        return response({ grantId: GRANT_ID, systemRevision: 5, confirmation: "Exact generation confirmation" }, 201);
      }
      return response({ revision: 5, desiredMode: "autonomous", outcome: "healthy", status: "completed", components: [] });
    }
  });
  await controls.ready;
  dom.window.document.querySelector("[data-agentic-gpu]").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.filter((call) => call.options.method === "POST").map((call) => call.url), [
    "/api/agentic-os/preemption-grants"
  ]);
  controls.destroy();
});
