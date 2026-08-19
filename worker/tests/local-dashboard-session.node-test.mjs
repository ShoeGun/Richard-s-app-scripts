import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLocalDashboardSession,
  ensureEdgeOpsControlCapability,
  requestHasEdgeOpsControlCapability,
} from "../lib/local-dashboard-session.mjs";

test("EdgeOps capability atomically recovers an invalid regular file without accepting cookies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edgeops-capability-"));
  try {
    const filePath = path.join(root, "edgeops-control.capability");
    await writeFile(filePath, "truncated", "utf8");
    const value = await ensureEdgeOpsControlCapability({ filePath });
    assert.match(value, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal((await readdir(root)).some((entry) => entry.startsWith("edgeops-control.capability.invalid-")), true);
    assert.equal(requestHasEdgeOpsControlCapability({ headers: { "x-edgeops-control-capability": value } }, value), true);
    assert.equal(requestHasEdgeOpsControlCapability({ headers: { cookie: `edgeops=${value}` } }, value), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EdgeOps browser authorization requires one native-issued, exact-3210 bootstrap", () => {
  const values = ["a".repeat(43), "b".repeat(43)];
  const sessions = createLocalDashboardSession({ makeToken: () => values.shift() });
  const template = '<meta name="edgeops-browser-session" content="__EDGEOPS_BROWSER_SESSION__">';
  assert.match(sessions.injectHtml(template), /content=""/u);
  const issued = sessions.issueBootstrap();
  assert.equal(issued.bootstrapUrl, `http://127.0.0.1:3210/?bootstrap=${"a".repeat(43)}`);
  const authorized = sessions.injectHtml(template, { bootstrapId: "a".repeat(43) });
  assert.match(authorized, new RegExp("b".repeat(43), "u"));
  assert.equal(sessions.injectHtml(template, { bootstrapId: "a".repeat(43) }).includes("b".repeat(43)), false);
  assert.equal(sessions.authorizes({ headers: { host: "127.0.0.1:3210", "x-edgeops-browser-session": "b".repeat(43) } }), true);
  assert.equal(sessions.authorizes({ headers: { host: "127.0.0.1:3220", "x-edgeops-browser-session": "b".repeat(43) } }), false);
});
