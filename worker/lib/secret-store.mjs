import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ALLOWED_SECRET_NAMES = Object.freeze([
  "COPILOT_GITHUB_TOKEN",
  "ELEVENLABS_API_KEY",
  "GITHUB_TOKEN",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "RESEMBLE_API_KEY",
  "ZAI_API_KEY"
]);

const allowed = new Set(ALLOWED_SECRET_NAMES);
const localData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
export const SECRET_STORE_PATH = path.join(localData, "EdgeOps", "provider-secrets.json");

function assertAllowed(name) {
  if (!allowed.has(name)) throw new Error(`Unsupported secret name: ${name}`);
}

function readStoreSync() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRET_STORE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function storedSecret(name) {
  assertAllowed(name);
  const value = readStoreSync()[name];
  return typeof value === "string" && value ? value : null;
}

export function resolvedSecret(name) {
  assertAllowed(name);
  return storedSecret(name) || process.env[name];
}

export function secretsConfigured(names) {
  return names.length === 0 || names.some((name) => {
    if (!allowed.has(name)) return Boolean(process.env[name]);
    return Boolean(resolvedSecret(name));
  });
}

export function secretStatus() {
  const store = readStoreSync();
  return Object.fromEntries(ALLOWED_SECRET_NAMES.map((name) => [
    name,
    {
      configured: Boolean(store[name] || process.env[name]),
      source: store[name] ? "local-store" : process.env[name] ? "environment" : null
    }
  ]));
}

export async function setStoredSecret(name, value) {
  assertAllowed(name);
  if (typeof value !== "string" || value.length < 8 || value.length > 8192) {
    throw new Error("Secret value must be between 8 and 8,192 characters.");
  }
  const directory = path.dirname(SECRET_STORE_PATH);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const next = { ...readStoreSync(), [name]: value.trim() };
  const temporary = `${SECRET_STORE_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporary, SECRET_STORE_PATH);
  await fsp.chmod(SECRET_STORE_PATH, 0o600).catch(() => {});
}

export async function deleteStoredSecret(name) {
  assertAllowed(name);
  const next = readStoreSync();
  delete next[name];
  const directory = path.dirname(SECRET_STORE_PATH);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${SECRET_STORE_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporary, SECRET_STORE_PATH);
  await fsp.chmod(SECRET_STORE_PATH, 0o600).catch(() => {});
}
