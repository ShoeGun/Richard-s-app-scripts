#!/usr/bin/env node

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8765";

function parseArgs(argv) {
  const options = { voice: "rachael", tier: "quality", gateway: process.env.VOICE_NOTIFICATION_GATEWAY_URL || DEFAULT_GATEWAY_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--text") options.text = argv[++index];
    else if (token === "--voice") options.voice = argv[++index];
    else if (token === "--tier") options.tier = argv[++index];
    else if (token === "--gateway") options.gateway = argv[++index];
    else throw new Error(`Unknown option: ${token}`);
  }
  if (!options.text?.trim()) throw new Error("--text is required");
  if (!/^https?:\/\//.test(options.gateway)) throw new Error("gateway must be an http(s) URL");
  if (!new Set(["fast", "quality"]).has(options.tier)) throw new Error("--tier must be fast or quality");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.VOICE_GATEWAY_DEV_TOKEN || process.env.VOICE_NOTIFICATION_GATEWAY_TOKEN;
  if (!token) throw new Error("VOICE_GATEWAY_DEV_TOKEN is not configured for this process");
  const response = await fetch(`${options.gateway.replace(/\/+$/, "")}/api/v1/notifications/voice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text: options.text.trim(),
      presentation_id: options.voice === "rachael" ? "rachael-v1" : options.voice,
      tts_provider: "voicebox",
      tts_tier: options.tier,
      playback: true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code || "voice_notification_failed";
    throw new Error(`${code} (${response.status})`);
  }
  console.log(JSON.stringify({
    notification_id: payload.notification_id,
    provider: payload.provider,
    tts_tier: payload.tts_tier,
    playback: payload.playback,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
