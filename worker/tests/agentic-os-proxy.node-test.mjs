import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTIC_OS_CAPABILITY_PATH,
  AGENTIC_OS_BOOTSTRAP_SCRIPT,
  AGENTIC_OS_RECONCILE_URL,
  AGENTIC_OS_PREEMPTION_GRANT_URL,
  AGENTIC_OS_STATUS_URL,
  createAgenticOsProxy
} from "../lib/agentic-os-proxy.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("status uses only the fixed loopback controller URL", async () => {
  const calls = [];
  const proxy = createAgenticOsProxy({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ revision: 4, desiredMode: "autonomous" });
    },
    runBootstrap: async () => assert.fail("healthy controller must not bootstrap")
  });

  const status = await proxy.status();

  assert.equal(status.revision, 4);
  assert.deepEqual(calls.map(({ url }) => url), [AGENTIC_OS_STATUS_URL]);
  assert.equal(calls[0].options.method, "GET");
});

test("a down controller invokes the one fixed bootstrap and retries status", async () => {
  const calls = [];
  const bootstraps = [];
  const proxy = createAgenticOsProxy({
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) throw new TypeError("fetch failed");
      return jsonResponse({ revision: 1, desiredMode: "autonomous" });
    },
    runBootstrap: async (scriptPath) => bootstraps.push(scriptPath)
  });

  const status = await proxy.status();

  assert.deepEqual(calls, [AGENTIC_OS_STATUS_URL, AGENTIC_OS_STATUS_URL]);
  assert.deepEqual(bootstraps, [AGENTIC_OS_BOOTSTRAP_SCRIPT]);
  assert.equal(status.proxy.bootstrapped, true);
});

test("preemption grant and reconcile use the fixed authenticated controller routes", async () => {
  const calls = [];
  let attempts = 0;
  const proxy = createAgenticOsProxy({
    makeCommandId: () => "3210-00000000-0000-4000-8000-000000000001",
    readCapability: async () => "a".repeat(43),
    fetchImpl: async (url, options) => {
      attempts += 1;
      calls.push({ url, body: JSON.parse(options.body), capability: options.headers["x-agentic-os-capability"] });
      if (url === AGENTIC_OS_PREEMPTION_GRANT_URL) return jsonResponse({ grantId: "p".repeat(43), confirmation: "exact" });
      if (attempts === 2) throw new TypeError("controller offline");
      return jsonResponse({ status: "ready", revision: 8, components: [] });
    },
    runBootstrap: async (scriptPath) => assert.equal(scriptPath, AGENTIC_OS_BOOTSTRAP_SCRIPT)
  });

  const grant = await proxy.preemptionGrant({ desiredMode: "gpu-focus" });
  assert.equal(grant.grantId, "p".repeat(43));
  const receipt = await proxy.reconcile({ desiredMode: "gpu-focus", expectedRevision: 7, preemptionGrantId: "p".repeat(43) });

  assert.deepEqual(calls.slice(-2), [
    {
      url: AGENTIC_OS_RECONCILE_URL,
      capability: "a".repeat(43), body: {
        commandId: "3210-00000000-0000-4000-8000-000000000001",
        desiredMode: "gpu-focus",
        expectedRevision: 7,
        preemptionGrantId: "p".repeat(43)
      }
    },
    {
      url: AGENTIC_OS_RECONCILE_URL,
      capability: "a".repeat(43), body: {
        commandId: "3210-00000000-0000-4000-8000-000000000001",
        desiredMode: "gpu-focus",
        expectedRevision: 7,
        preemptionGrantId: "p".repeat(43)
      }
    }
  ]);
  assert.equal(receipt.proxy.bootstrapped, true);
  assert.equal(calls[0].url, AGENTIC_OS_PREEMPTION_GRANT_URL);
});

test("capability path is fixed outside the repo and missing capability blocks mutation", async () => {
  assert.equal(AGENTIC_OS_CAPABILITY_PATH, "C:\\Users\\Richard\\AppData\\Local\\AgenticOS\\control.capability");
  let calls = 0;
  const proxy = createAgenticOsProxy({
    fetchImpl: async () => { calls += 1; return jsonResponse({}); },
    readCapability: async () => { throw new Error("private"); },
    runBootstrap: async () => {},
  });
  await assert.rejects(proxy.reconcile({ desiredMode: "gpu-focus", preemptionGrantId: "p".repeat(43) }), /capability is unavailable/u);
  assert.equal(calls, 0);
});

test("reconcile rejects extra fields, unknown modes, and invalid revisions before I/O", async () => {
  let fetchCalls = 0;
  const proxy = createAgenticOsProxy({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
    runBootstrap: async () => {}
  });

  await assert.rejects(
    proxy.reconcile({ desiredMode: "autonomous", url: "http://example.invalid" }),
    /only desiredMode, expectedRevision, and preemptionGrantId/
  );
  await assert.rejects(proxy.reconcile({ desiredMode: "destroy-everything" }), /desiredMode/);
  await assert.rejects(proxy.reconcile({ desiredMode: "autonomous", expectedRevision: -1, preemptionGrantId: "p".repeat(43) }), /expectedRevision/);
  await assert.rejects(proxy.reconcile({ desiredMode: "autonomous", expectedRevision: 0 }), /preemptionGrantId/);
  assert.equal(fetchCalls, 0);
});

test("an HTTP response proves the controller is reachable and never triggers bootstrap", async () => {
  let bootstraps = 0;
  const proxy = createAgenticOsProxy({
    fetchImpl: async () => jsonResponse({ error: "revision conflict" }, 409),
    readCapability: async () => "a".repeat(43),
    runBootstrap: async () => { bootstraps += 1; }
  });

  await assert.rejects(
    proxy.reconcile({ desiredMode: "autonomous", expectedRevision: 2, preemptionGrantId: "p".repeat(43) }),
    (error) => error.statusCode === 409 && /revision conflict/.test(error.message)
  );
  assert.equal(bootstraps, 0);
});

test("controller responses are bounded and an oversized reachable response is not treated as downtime", async () => {
  let bootstraps = 0;
  const proxy = createAgenticOsProxy({
    fetchImpl: async () => new Response("x".repeat((1024 * 1024) + 1), { status: 200 }),
    runBootstrap: async () => { bootstraps += 1; }
  });

  await assert.rejects(proxy.status(), /response is too large/);
  assert.equal(bootstraps, 0);
});

test("concurrent down-controller requests share one bootstrap invocation", async () => {
  let attempts = 0;
  let bootstraps = 0;
  let releaseBootstrap;
  const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve; });
  const proxy = createAgenticOsProxy({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw new TypeError("offline");
      return jsonResponse({ revision: 3, desiredMode: "autonomous" });
    },
    runBootstrap: async () => {
      bootstraps += 1;
      await bootstrapGate;
    }
  });

  const first = proxy.status();
  const second = proxy.status();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bootstraps, 1);
  releaseBootstrap();
  await Promise.all([first, second]);
  assert.equal(bootstraps, 1);
});
