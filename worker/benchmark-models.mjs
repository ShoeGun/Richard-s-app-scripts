import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config.json");
const OUTPUT_DIR = path.join(ROOT, "BENCHMARKS");
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
const models = requested.length ? requested : [
  "qwen3:8b",
  "qwen2.5-coder:7b",
  "qwen2.5-coder:14b",
  "huihui_ai/qwen3.5-abliterated:9b"
];

const cases = [
  {
    id: "focused-proposal",
    prompt: `You are a bounded coding worker. Return only JSON:
{"summary":"...","edits":[{"path":"relative file path","content":"complete content"}],"commands":[],"notes":[]}

Task T003: add a typed analytics worker protocol for DuckDB-Wasm.
Allowed focus: src/, public/, README.md, package.json, package-lock.json.
Forbidden: worker/, .github/, TASKS.md, orchestration state, deployment workflow.
Existing directories include src and public. Never use a directory as an edit path.
Produce a minimal proposal with one new TypeScript file under src/workers/.`,
    score(text) {
      try {
        const parsed = JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```json\s*|\s*```$/gi, "").trim());
        const edits = parsed.edits;
        const paths = Array.isArray(edits) ? edits.map((edit) => edit.path) : [];
        const validPath = paths.length === 1 && /^src\/workers\/[^/]+\.ts$/.test(paths[0]);
        const complete = typeof edits?.[0]?.content === "string" && edits[0].content.length > 120;
        const forbidden = paths.some((value) => /^(worker|\.github|TASKS\.md|src$|public$)/.test(value));
        return { points: Number(validPath) + Number(complete) + Number(!forbidden), maxPoints: 3, details: { paths, validPath, complete, forbidden } };
      } catch (error) {
        return { points: 0, maxPoints: 3, details: { parseError: error.message } };
      }
    }
  },
  {
    id: "seeded-review",
    prompt: `Review this bounded task diff. Return only JSON:
{"pass":true|false,"notes":"short reason","risk":"low|medium|high"}

Task: T003 DuckDB-Wasm dataset loading. Allowed focus is src/, public/, README.md, package manifests.
Diff:
--- a/.github/workflows/pages.yml
+++ b/.github/workflows/pages.yml
@@
 - run: npm run typecheck
 - run: npm run lint
 - run: npm run test
  run: npm run build

--- /dev/null
+++ b/src/workers/analytics.worker.ts
+export const ready = true;

Judge scope and regression risk.`,
    score(text) {
      try {
        const parsed = JSON.parse(text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```json\s*|\s*```$/gi, "").trim());
        const notes = String(parsed.notes || "").toLowerCase();
        const caught = parsed.pass === false && (notes.includes("workflow") || notes.includes("pages.yml") || notes.includes("typecheck") || notes.includes("lint") || notes.includes("test"));
        const risk = ["medium", "high"].includes(String(parsed.risk || "").toLowerCase());
        return { points: Number(caught) + Number(risk), maxPoints: 2, details: { pass: parsed.pass, notes: parsed.notes, risk: parsed.risk, caught } };
      } catch (error) {
        return { points: 0, maxPoints: 2, details: { parseError: error.message } };
      }
    }
  }
];

async function generate(model, prompt) {
  const startedAt = Date.now();
  const response = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      keep_alive: 0,
      format: "json",
      options: {
        num_ctx: 8192,
        temperature: 0
      }
    }),
    signal: AbortSignal.timeout(20 * 60 * 1000)
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return {
    text: data.response || "",
    durationMs: Date.now() - startedAt,
    promptTokens: data.prompt_eval_count || 0,
    completionTokens: data.eval_count || 0,
    promptTokensPerSecond: data.prompt_eval_duration ? (data.prompt_eval_count / data.prompt_eval_duration) * 1e9 : null,
    completionTokensPerSecond: data.eval_duration ? (data.eval_count / data.eval_duration) * 1e9 : null
  };
}

const results = [];
for (const model of models) {
  const modelResult = { model, cases: [], points: 0, maxPoints: 0, errors: [] };
  for (const benchmarkCase of cases) {
    try {
      const generation = await generate(model, benchmarkCase.prompt);
      const score = benchmarkCase.score(generation.text);
      modelResult.cases.push({
        id: benchmarkCase.id,
        ...generation,
        text: generation.text.slice(0, 12000),
        score
      });
      modelResult.points += score.points;
      modelResult.maxPoints += score.maxPoints;
      console.log(`${model} ${benchmarkCase.id}: ${score.points}/${score.maxPoints} in ${generation.durationMs}ms`);
    } catch (error) {
      modelResult.errors.push({ id: benchmarkCase.id, error: error.message });
      modelResult.maxPoints += benchmarkCase.id === "focused-proposal" ? 3 : 2;
      console.error(`${model} ${benchmarkCase.id}: ${error.message}`);
    }
  }
  results.push(modelResult);
}

const capturedAt = new Date().toISOString();
const report = {
  version: 1,
  capturedAt,
  host: "RTX 3070 8GB / 64GB RAM",
  contextTokens: 8192,
  temperature: 0,
  results
};
await fs.mkdir(OUTPUT_DIR, { recursive: true });
const outputPath = path.join(OUTPUT_DIR, `local-model-routing-${capturedAt.replace(/[:.]/g, "-")}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(OUTPUT_DIR, "local-model-routing-latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Saved ${outputPath}`);
