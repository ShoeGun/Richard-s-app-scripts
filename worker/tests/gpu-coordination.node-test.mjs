import assert from "node:assert/strict";
import test from "node:test";

import { yieldVoiceboxGpu } from "../lib/gpu-coordination.mjs";

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

test("does nothing when Voicebox has no loaded model", async () => {
  const calls = [];
  const result = await yieldVoiceboxGpu({
    fetchImpl: async (url, init) => {
      calls.push([url, init?.method || "GET"]);
      return response({ model_loaded: false });
    }
  });

  assert.deepEqual(result, { yielded: true, modelWasLoaded: false, reason: null });
  assert.deepEqual(calls.map(([, method]) => method), ["GET"]);
});

test("unloads and verifies a loaded Voicebox model", async () => {
  const calls = [];
  const results = [
    response({ model_loaded: true }),
    response({ message: "unloaded" }),
    response({ model_loaded: false })
  ];
  const result = await yieldVoiceboxGpu({
    fetchImpl: async (url, init) => {
      calls.push([url, init?.method || "GET"]);
      return results.shift();
    }
  });

  assert.deepEqual(result, { yielded: true, modelWasLoaded: true, reason: null });
  assert.deepEqual(calls.map(([, method]) => method), ["GET", "POST", "GET"]);
});

test("keeps the GPU blocked when Voicebox cannot prove release", async () => {
  const result = await yieldVoiceboxGpu({
    fetchImpl: async () => response({ detail: "busy" }, false, 503)
  });

  assert.equal(result.yielded, false);
  assert.match(result.reason, /Voicebox GPU yield failed: busy/);
});
