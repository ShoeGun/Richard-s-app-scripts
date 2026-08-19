import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("3210 serves a read-only dashboard and exact authenticated reconcile deputy", async () => {
  const source = await fs.readFile(path.join(root, "worker", "control-plane.mjs"), "utf8");
  const html = await fs.readFile(path.join(root, "worker", "dashboard", "index.html"), "utf8");
  const client = await fs.readFile(path.join(root, "worker", "dashboard", "agentic-os-controls.js"), "utf8");

  assert.match(source, /edgeops-control\.capability/u);
  assert.match(source, /requestHasEdgeOpsControlCapability/u);
  assert.match(source, /assertExactLocalMutation/u);
  assert.match(source, /edgeOpsBrowserSessions\.authorizes\(request\)/u);
  assert.match(source, /\/api\/agentic-os\/browser-sessions/u);
  assert.match(source, /\/api\/agentic-os\/preemption-grants/u);
  assert.match(source, /\/api\/agentic-os\/reconcile/u);
  assert.match(source, /"referrer-policy":\s*"no-referrer"/u);
  assert.match(source, /new URL\(request\.url, `http:\/\/\$\{HOST\}:\$\{PORT\}`\)/u);
  assert.doesNotMatch(source, /new URL\(request\.url,[^\r\n]*request\.headers\.host/u);
  assert.match(html, /__EDGEOPS_BROWSER_SESSION__/u);
  assert.match(client, /x-edgeops-browser-session/u);
  assert.match(client, /history\.replaceState/u);
  assert.match(client, /preemptionGrantId:\s*grant\.grantId/u);
  assert.match(client, /expectedRevision:\s*grant\.systemRevision/u);
  assert.match(client, /confirmImpl\(grant\.confirmation/u);
});

test("trusted 3210 launcher contains no secret and requests a one-time browser bootstrap", async () => {
  const launcherPath = path.join(root, "scripts", "open-edgeops-dashboard.ps1");
  const source = await fs.readFile(launcherPath, "utf8");
  const escaped = launcherPath.replaceAll("'", "''");
  const parse = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}`
  ], { encoding: "utf8" });

  assert.equal(parse.status, 0, parse.stderr || parse.stdout);
  assert.match(source, /edgeops-control\.capability/u);
  assert.match(source, /X-EdgeOps-Control-Capability/u);
  assert.match(source, /\/api\/agentic-os\/browser-sessions/u);
  assert.match(source, /Start-Process/u);
  assert.doesNotMatch(source, /start-agentic-os\.ps1/u);
  assert.doesNotMatch(source, /AgenticBootstrap/u);
  assert.doesNotMatch(source, /["'][A-Za-z0-9_-]{43}["']/u);
});
