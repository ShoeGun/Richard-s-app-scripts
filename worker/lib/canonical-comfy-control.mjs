export function createCanonicalComfyControl({
  fetchImpl = globalThis.fetch,
  baseUrl = "http://127.0.0.1:3220"
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Canonical Comfy control requires fetch.");
  const managerUrl = baseUrl.replace(/\/$/u, "");

  async function start({ makeRoom = false } = {}) {
    const response = await fetchImpl(`${managerUrl}/api/creative/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: "photo.professional-natural",
        gpuPolicy: makeRoom ? "make-room" : "wait"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const error = new Error(payload.error || `Canonical creative manager returned HTTP ${response.status}.`);
      error.code = payload.code || "CANONICAL_COMFY_FAILED";
      error.status = response.status || 502;
      throw error;
    }
    const state = String(payload.state || "blocked");
    return {
      status: state === "ready" ? "running" : "waiting",
      state,
      url: payload.comfy?.url || "http://127.0.0.1:8188",
      managerUrl,
      leaseId: payload.resourceSession?.session?.id || null,
      message: payload.message || (state === "ready" ? "ComfyUI is ready." : "The creative GPU handoff is blocked.")
    };
  }

  return Object.freeze({ start });
}
