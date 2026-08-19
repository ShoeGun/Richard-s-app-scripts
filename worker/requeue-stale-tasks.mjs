import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORKER_DIR, "..");
const STATE_PATH = path.join(ROOT, "WORKER_STATE.json");
const PAUSE_PATH = path.join(ROOT, ".worker-control", "paused");
const STALE_STATUSES = new Set(["blocked", "awaiting_escalation"]);
const VALIDATIONS = [
  ["run", "typecheck"],
  ["run", "lint"],
  ["run", "test"],
  ["run", "build"]
];
const TRANSIENT_FIELDS = [
  "startedAt",
  "completedAt",
  "lastError",
  "workspaceBlockedAt",
  "workspaceBlockedReason",
  "failureFingerprints",
  "lastFailureFingerprint",
  "lastFailureFingerprintCount",
  "escalationRequestedAt",
  "escalationRequestPath",
  "escalationChannel",
  "escalationLadderIndex",
  "escalationAutoInvoke",
  "escalationAutoInvokeError",
  "escalationAnswer",
  "escalationAnswerChannel",
  "escalationAnswerPath",
  "escalationResolvedAt"
];

if (!existsSync(PAUSE_PATH)) {
  throw new Error("Refusing to requeue tasks while the worker is not paused.");
}

for (const args of VALIDATIONS) {
  console.log(`Validating: npm ${args.join(" ")}`);
  execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    timeout: 180_000
  });
}

const state = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
const requestedIds = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const completeTasks = process.argv.includes("--complete");
const includePending = process.argv.includes("--pending");
const candidates = Object.entries(state.taskStates || {}).filter(([id, task]) =>
  (STALE_STATUSES.has(task.status) || ((includePending || completeTasks) && task.status === "pending"))
  && (requestedIds.length === 0 || requestedIds.includes(id))
);
if (!candidates.length) {
  console.log("No matching stale tasks found.");
  process.exit(0);
}

const resetAt = new Date().toISOString();
for (const [id, task] of candidates) {
  task.escalationHistory ||= [];
  task.escalationHistory.push({
    at: resetAt,
    event: "operator-requeued",
    priorStatus: task.status,
    reason: "Current workspace validation passed; stale blocker cleared."
  });
  for (const field of TRANSIENT_FIELDS) delete task[field];
  task.status = completeTasks ? "completed" : "pending";
  task.repairCycles = 0;
  if (completeTasks) task.completedAt = resetAt;
  task.resetAt = resetAt;
  task.resetReason = completeTasks
    ? "Operator verified the task in a real browser and all workspace gates passed."
    : "Current workspace validation passed; stale blocker cleared.";
  console.log(`${completeTasks ? "Completed" : "Requeued"} ${id}; preserved ${task.attempts || 0} historical attempts.`);
}

state.status = "paused";
state.currentTaskId = null;
state.lastHeartbeat = resetAt;
state.lastError = "Stale blockers cleared after a passing workspace baseline.";

const temporary = `${STATE_PATH}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    await fs.rename(temporary, STATE_PATH);
    break;
  } catch (error) {
    if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt === 4) {
      await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await fs.rm(temporary, { force: true }).catch(() => {});
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
}
