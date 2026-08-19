import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalComfyControl } from "../lib/canonical-comfy-control.mjs";

test("3210 delegates Comfy admission to the canonical creative resource manager", async () => {
  const calls = [];
  const control = createCanonicalComfyControl({
    async fetchImpl(url, options) {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({
        state: "ready",
        message: "Professional natural finish is prepared and ComfyUI is ready.",
        comfy: { url: "http://127.0.0.1:8188" },
        resourceSession: { session: { id: "lease-1" } }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
  });

  const result = await control.start({ makeRoom: true });

  assert.equal(calls[0].url, "http://127.0.0.1:3220/api/creative/sessions");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    intentId: "photo.professional-natural",
    gpuPolicy: "make-room"
  });
  assert.deepEqual(result, {
    status: "running",
    state: "ready",
    url: "http://127.0.0.1:8188",
    managerUrl: "http://127.0.0.1:3220",
    leaseId: "lease-1",
    message: "Professional natural finish is prepared and ComfyUI is ready."
  });
});

test("a protected or failed canonical handoff is not reported as completed", async () => {
  const control = createCanonicalComfyControl({
    async fetchImpl() {
      return new Response(JSON.stringify({ error: "Supervisor request is protected.", code: "CONFLICT_PROTECTED" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await assert.rejects(
    control.start({ makeRoom: true }),
    (error) => error.code === "CONFLICT_PROTECTED" && error.status === 409 && /protected/i.test(error.message)
  );
});
