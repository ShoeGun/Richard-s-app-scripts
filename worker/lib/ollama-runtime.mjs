function normalizeModelName(value) {
  return String(value || "").replace(/:latest$/i, "");
}

export async function evictOtherOllamaModels(baseUrl, desiredModel, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}/api/ps`);
  if (!response.ok) throw new Error(`Ollama process inventory failed: ${response.status}`);
  const inventory = await response.json();
  const desired = normalizeModelName(desiredModel);
  const loaded = Array.isArray(inventory.models) ? inventory.models : [];
  const evicted = [];

  for (const entry of loaded) {
    const model = entry.name || entry.model;
    if (!model || normalizeModelName(model) === desired) continue;
    const unload = await fetchImpl(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: 0 })
    });
    if (!unload.ok) throw new Error(`Ollama failed to unload ${model}: ${unload.status}`);
    evicted.push(model);
  }
  return evicted;
}
