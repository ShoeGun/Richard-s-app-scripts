import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { commitPathsForProposal, validateProposal } from "../lib/proposal.mjs";

async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "edgeops-proposal-"));
  try {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "App.tsx"), "export default function App() {}\n");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("accepts focused file edits and returns scoped commit paths", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T1", focus: ["src"] },
    action: { edits: [{ path: "src/App.tsx", content: "export default function App() { return null }\n" }] }
  });
  assert.deepEqual(commitPathsForProposal(proposal), ["src/App.tsx"]);
}));

test("rejects a directory as an edit target before reading it", async () => withRoot(async (root) => {
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T1", focus: ["src"] },
      action: { edits: [{ path: "src", content: "bad" }] }
    }),
    /existing directory/
  );
}));

test("rejects files outside task focus and protected orchestration files", async () => withRoot(async (root) => {
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T3", focus: ["src", "public"] },
      action: { edits: [{ path: ".github/workflows/pages.yml", content: "name: unsafe\n" }] }
    }),
    /outside task T3 focus/
  );
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T3", focus: ["src", "TASKS.md"] },
      action: { edits: [{ path: "TASKS.md", content: "rewrite queue" }] }
    }),
    /may not edit orchestration path/
  );
}));

test("allows dependency manifests and includes generated lockfile in commit scope", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T3", focus: ["src"] },
    action: { edits: [{ path: "package.json", content: "{\"name\":\"demo\"}\n" }] }
  });
  assert.deepEqual(commitPathsForProposal(proposal), ["package.json", "package-lock.json"]);
}));
