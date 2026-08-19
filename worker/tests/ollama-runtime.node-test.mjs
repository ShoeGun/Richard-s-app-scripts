import assert from "node:assert/strict";
import test from "node:test";

import { evictOtherOllamaModels } from "../lib/ollama-runtime.mjs";

test("evicts a foreign loaded model but preserves the requested model", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/ps")) {
      return {
        ok: true,
        json: async () => ({
          models: [
            { name: "qwen3.5:9b" },
            { name: "hermes-test-qwen3.5:latest" }
          ]
        })
      };
    }
    return { ok: true };
  };

  const evicted = await evictOtherOllamaModels("http://localhost:11434", "qwen3.5:9b", fetchImpl);
  assert.deepEqual(evicted, ["hermes-test-qwen3.5:latest"]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.body, /hermes-test-qwen3\.5/);
});
