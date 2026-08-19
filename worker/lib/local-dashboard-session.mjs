import { randomBytes, timingSafeEqual } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const MARKER = "__EDGEOPS_BROWSER_SESSION__";

function unavailable(code) {
  const error = new Error("The EdgeOps local control capability is unavailable.");
  error.code = code;
  error.statusCode = 503;
  return Object.seal(error);
}

async function readExact(filePath) {
  const facts = await lstat(filePath).catch(() => null);
  if (!facts?.isFile() || facts.isSymbolicLink() || facts.size > 256) throw unavailable("EDGEOPS_CAPABILITY_INVALID");
  const value = (await readFile(filePath, "utf8").catch(() => "")).trim();
  if (!TOKEN.test(value)) throw unavailable("EDGEOPS_CAPABILITY_INVALID");
  return value;
}

async function quarantine(filePath) {
  const facts = await lstat(filePath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!facts) return;
  if (!facts.isFile() || facts.isSymbolicLink()) throw unavailable("EDGEOPS_CAPABILITY_UNSAFE_TYPE");
  const destination = `${filePath}.invalid-${Date.now()}-${randomBytes(8).toString("hex")}`;
  await rename(filePath, destination).catch((error) => {
    if (error?.code !== "ENOENT") throw unavailable("EDGEOPS_CAPABILITY_QUARANTINE_FAILED");
  });
}

async function publish(filePath, value) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.creating-${process.pid}-${randomBytes(8).toString("hex")}`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${value}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw unavailable("EDGEOPS_CAPABILITY_CREATE_FAILED");
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export async function ensureEdgeOpsControlCapability({ filePath } = {}) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new TypeError("Capability path must be absolute.");
  await mkdir(path.dirname(filePath), { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await readExact(filePath);
    } catch (error) {
      if (error.code !== "EDGEOPS_CAPABILITY_INVALID") throw error;
      if (await lstat(filePath).catch(() => null)) {
        await quarantine(filePath);
        continue;
      }
      await publish(filePath, randomBytes(32).toString("base64url"));
    }
  }
  throw unavailable("EDGEOPS_CAPABILITY_RECOVERY_EXHAUSTED");
}

export function requestHasEdgeOpsControlCapability(request, expected) {
  const candidate = request?.headers?.["x-edgeops-control-capability"];
  return typeof candidate === "string" && TOKEN.test(candidate) && TOKEN.test(expected)
    && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export function createLocalDashboardSession({
  makeToken = () => randomBytes(32).toString("base64url"),
  clock = { now: () => Date.now() },
  bootstrapTtlMs = 60_000,
  sessionTtlMs = 12 * 60 * 60_000,
} = {}) {
  const bootstraps = new Map();
  const sessions = new Map();
  const authorities = new Set(["127.0.0.1:3210", "localhost:3210"]);
  const now = () => {
    const value = clock.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Dashboard-session clock is invalid.");
    return value;
  };
  const token = () => {
    const value = makeToken();
    if (!TOKEN.test(value)) throw new TypeError("Dashboard-session token generator is invalid.");
    return value;
  };
  const prune = (at) => {
    for (const [id, expiry] of bootstraps) if (expiry < at) bootstraps.delete(id);
    for (const [id, expiry] of sessions) if (expiry < at) sessions.delete(id);
  };
  return Object.freeze({
    issueBootstrap() {
      const at = now();
      prune(at);
      const bootstrapId = token();
      if (bootstraps.has(bootstrapId) || sessions.has(bootstrapId)) throw unavailable("EDGEOPS_BOOTSTRAP_COLLISION");
      const expiresAt = at + bootstrapTtlMs;
      bootstraps.set(bootstrapId, expiresAt);
      return { version: 1, bootstrapUrl: `http://127.0.0.1:3210/?bootstrap=${bootstrapId}`, expiresAt };
    },
    injectHtml(html, { bootstrapId = null } = {}) {
      if (typeof html !== "string" || html.split(MARKER).length !== 2) throw new TypeError("Dashboard HTML requires one bootstrap marker.");
      const at = now();
      prune(at);
      let session = "";
      if (TOKEN.test(bootstrapId) && (bootstraps.get(bootstrapId) ?? -1) >= at) {
        bootstraps.delete(bootstrapId);
        session = token();
        sessions.set(session, at + sessionTtlMs);
      }
      return html.replace(MARKER, session);
    },
    authorizes(request) {
      const at = now();
      prune(at);
      const candidate = request?.headers?.["x-edgeops-browser-session"];
      return authorities.has(String(request?.headers?.host || "").toLowerCase())
        && typeof candidate === "string" && TOKEN.test(candidate)
        && (sessions.get(candidate) ?? -1) >= at;
    },
  });
}
