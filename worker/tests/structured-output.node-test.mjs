import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonObject } from "../lib/structured-output.mjs";

test("parses direct and fenced JSON objects", () => {
  assert.deepEqual(extractJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(extractJsonObject('result:\n```json\n{"ok":true}\n```'), { ok: true });
});

test("falls back when a small model places its only JSON inside think tags", () => {
  assert.deepEqual(
    extractJsonObject('<think>\n{"summary":"proposal","edits":[],"commands":[]}\n</think>'),
    { summary: "proposal", edits: [], commands: [] }
  );
});
