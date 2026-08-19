import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const STATE_PATH = path.join(ROOT, "LOOPS", "gpu-tool-handoff.json");
const args = process.argv.slice(2);
const command = args[0] || "status";

function value(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, "utf8")); }
  catch { return { version: 1, status: "idle", owner: null, nextStage: null }; }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tempPath = `${STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, STATE_PATH);
}

const now = () => new Date().toISOString();
const state = await readState();

if (command === "status") {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

if (command === "reserve") {
  const taskId = value("--task-id");
  const workflowId = value("--workflow-id");
  if (!taskId || !workflowId) throw new Error("reserve requires --task-id and --workflow-id");
  if (!["idle", "released", "handoff_ready"].includes(state.status)) {
    throw new Error(`GPU handoff is already ${state.status} for ${state.taskId || "an unknown task"}`);
  }
  const reserved = {
    version: 1,
    status: "reserved",
    owner: "comfyui",
    taskId,
    workflowId,
    estimatedHours: Number(value("--estimated-hours", 0)) || null,
    reservedAt: now(),
    startedAt: null,
    completedAt: null,
    releasedAt: null,
    artifactPath: null,
    nextStage: "glm52-evaluation",
    note: "GLM plans and evaluates; ComfyUI owns the GPU during the workflow."
  };
  await writeState(reserved);
  process.stdout.write(`${JSON.stringify(reserved, null, 2)}\n`);
  process.exit(0);
}

if (command === "start") {
  if (state.status !== "reserved") throw new Error("start requires a reserved ComfyUI handoff");
  state.status = "running";
  state.startedAt = now();
  await writeState(state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

if (command === "complete") {
  if (!["reserved", "running"].includes(state.status)) throw new Error(`complete cannot transition from ${state.status}`);
  state.status = "handoff_ready";
  state.completedAt = now();
  state.artifactPath = value("--artifact");
  state.nextStage = "glm52-evaluation";
  await writeState(state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

if (command === "release") {
  state.status = "released";
  state.releasedAt = now();
  state.owner = null;
  state.nextStage = null;
  await writeState(state);
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

throw new Error(`Unknown command: ${command}. Use status, reserve, start, complete, or release.`);
