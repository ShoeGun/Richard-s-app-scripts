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

test("serializes object content for JSON files", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T3", focus: ["src"] },
    action: {
      edits: [{
        path: "package.json",
        content: { name: "demo", private: true }
      }]
    }
  });
  assert.equal(proposal.edits[0].content, '{\n  "name": "demo",\n  "private": true\n}\n');
}));

test("expands compact exact replacements into final file content", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [{
        path: "src/App.tsx",
        replacements: [{
          find: "function App() {}",
          replace: "function App() { return null }"
        }]
      }]
    }
  });

  assert.equal(proposal.edits[0].content, "export default function App() { return null }\n");
  assert.equal(proposal.edits[0].mode, "replace");
}));

test("applies multiple compact replacements in order", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [{
        path: "src/App.tsx",
        replacements: [
          { find: "function App()", replace: "function Portfolio()" },
          { find: "export default function Portfolio", replace: "export default function App" }
        ]
      }]
    }
  });

  assert.equal(proposal.edits[0].content, "export default function App() {}\n");
}));

test("rejects missing or ambiguous compact replacement anchors", async () => withRoot(async (root) => {
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T8", focus: ["src"] },
      action: {
        edits: [{
          path: "src/App.tsx",
          replacements: [{ find: "missing text", replace: "new text" }]
        }]
      }
    }),
    /expected exactly once but found 0/
  );

  await fs.writeFile(path.join(root, "src", "App.tsx"), "same\nsame\n");
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T8", focus: ["src"] },
      action: {
        edits: [{
          path: "src/App.tsx",
          replacements: [{ find: "same", replace: "changed" }]
        }]
      }
    }),
    /expected exactly once but found 2/
  );
}));

test("requires full content for new files", async () => withRoot(async (root) => {
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T8", focus: ["src"] },
      action: {
        edits: [{
          path: "src/new.ts",
          replacements: [{ find: "old", replace: "new" }]
        }]
      }
    }),
    /requires full content because the file does not exist/
  );
}));

test("normalizes small-model edit mode echoes", async () => withRoot(async (root) => {
  const newFile = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [{
        path: "src/new.ts",
        content: "export const value = 1;\n",
        replacements: []
      }]
    }
  });
  assert.equal(newFile.edits[0].mode, "full");

  const existingFile = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [{
        path: "src/App.tsx",
        content: "incomplete echoed content",
        replacements: [{
          find: "function App() {}",
          replace: "function App() { return null }"
        }]
      }]
    }
  });
  assert.equal(existingFile.edits[0].content, "export default function App() { return null }\n");
}));

test("merges repeated compact edits for the same path", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [
        {
          path: "src/App.tsx",
          replacements: [{ find: "function App()", replace: "function Portfolio()" }]
        },
        {
          path: "src/App.tsx",
          content: "",
          replacements: [{
            find: "export default function Portfolio",
            replace: "export default function App"
          }]
        }
      ]
    }
  });

  assert.equal(proposal.edits.length, 1);
  assert.equal(proposal.edits[0].content, "export default function App() {}\n");
}));

test("ignores path-only no-op entries when useful edits remain", async () => withRoot(async (root) => {
  const proposal = await validateProposal({
    root,
    task: { id: "T8", focus: ["src"] },
    action: {
      edits: [
        { path: "src/App.tsx", replacements: [] },
        { path: "src/new.ts", content: "export const value = 1;\n" }
      ]
    }
  });

  assert.deepEqual(proposal.edits.map((edit) => edit.path), ["src/new.ts"]);
}));

test("rejects proposals containing only no-op entries", async () => withRoot(async (root) => {
  await assert.rejects(
    validateProposal({
      root,
      task: { id: "T8", focus: ["src"] },
      action: {
        edits: [{ path: "src/App.tsx", replacements: [] }]
      }
    }),
    /at least one actionable file edit/
  );
}));
