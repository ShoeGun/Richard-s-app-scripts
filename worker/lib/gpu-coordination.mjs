export async function yieldVoiceboxGpu({
  fetchImpl = fetch,
  baseUrl = "http://127.0.0.1:17493",
  timeoutMs = 3000
} = {}) {
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.message || `HTTP ${response.status}`);
    }
    return payload;
  };

  try {
    const before = await request("/health");
    if (before.model_loaded !== true) {
      return { yielded: true, modelWasLoaded: false, reason: null };
    }

    await request("/models/unload", { method: "POST" });
    const after = await request("/health");
    if (after.model_loaded === true) {
      return {
        yielded: false,
        modelWasLoaded: true,
        reason: "Voicebox reported a loaded model after unload"
      };
    }

    return { yielded: true, modelWasLoaded: true, reason: null };
  } catch (error) {
    return {
      yielded: false,
      modelWasLoaded: null,
      reason: `Voicebox GPU yield failed: ${error.message}`
    };
  }
}
