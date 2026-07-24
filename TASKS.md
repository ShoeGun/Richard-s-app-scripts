# EdgeOps Agent Studio Task Queue

The worker reads the JSON block below as the durable task queue. Keep tasks bounded to roughly 15-45 minutes of local work.

```worker-task-queue
[
  {
    "id": "T001",
    "title": "Migrate existing Pages portfolio to Vite scaffold",
    "objective": "Create a Vite React TypeScript scaffold inside the existing GitHub Pages repository while preserving or intentionally migrating the current portfolio content. Add lint, typecheck, unit test, and build scripts. Configure Vite base for the user Pages path `/` with an override for future project paths.",
    "focus": ["package.json", "index.html", "style.css", "script.js", "Code.gs", "src", "vite.config.ts", "tsconfig.json", "README.md", ".github/workflows/pages.yml"],
    "validation": ["npm install", "npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["React TypeScript app exists", "Existing portfolio content is preserved or intentionally migrated", "Vite base defaults to `/` and can be overridden", "GitHub Pages workflow builds dist", "No secrets or large binary model artifacts are introduced"]
  },
  {
    "id": "T002",
    "title": "Static UI shell",
    "dependsOn": ["T001"],
    "objective": "Build the first-screen portfolio app shell with workspace navigation, dataset panel, model panel, query composer, results area, and responsive accessible layout. Keep it appropriate for a portfolio homepage rather than a separate hosted app.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Usable app surface is first screen", "Responsive layout avoids overlapping text", "Accessibility labels and keyboard paths exist"]
  },
  {
    "id": "T003",
    "title": "DuckDB protocol and demo dataset",
    "dependsOn": ["T001"],
    "objective": "Add the DuckDB-Wasm dependency, a small deterministic demo CSV, and the typed request/response protocol for the analytics worker. Do not implement UI integration in this task.",
    "focus": ["package.json", "package-lock.json", "src/workers", "public/data", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["DuckDB-Wasm is installed through the package manifest", "Demo CSV has deterministic mixed-type rows", "Typed protocol covers initialization, dataset loading, schema inspection, and serializable errors"]
  },
  {
    "id": "T003B",
    "title": "DuckDB-Wasm analytics worker",
    "dependsOn": ["T003"],
    "objective": "Repair the analytics protocol to include request correlation ids and structured clone-safe errors, then implement DuckDB-Wasm initialization and demo dataset schema inspection inside an analytics Web Worker using Vite-managed worker and Wasm asset URLs.",
    "focus": ["src/workers", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Every request and response carries the same request id", "Errors are typed structured-clone-safe objects without any", "DuckDB runs off the main thread", "Worker and Wasm assets use Vite base-aware URLs", "Demo dataset loads and schema inspection returns clone-safe primitives", "Initialization and query failures return typed handled errors"]
  },
  {
    "id": "T003C",
    "title": "Analytics client and schema UI",
    "dependsOn": ["T003B"],
    "objective": "Add a narrow main-thread analytics client, connect the demo dataset workflow to the portfolio UI, and render loading, schema, and handled error states.",
    "focus": ["src/lib", "src/App.tsx", "src/App.test.tsx", "src/index.css", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Client correlates worker responses by request id", "UI can load the demo dataset and display its schema", "Loading and error states are accessible", "Tests cover request correlation and surfaced worker errors"]
  },
  {
    "id": "T004",
    "title": "Deterministic analysis without LLM",
    "dependsOn": ["T003C"],
    "objective": "Implement validated deterministic filtering, grouping, aggregation, sorting, limits, and chart selection without model involvement.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Included dataset can be analyzed", "Unsupported operations are rejected", "Unit tests cover plan execution"]
  },
  {
    "id": "T005",
    "title": "Structured analysis-plan schema",
    "dependsOn": ["T004"],
    "objective": "Define Zod schemas for model-generated analysis plans and strict validation errors.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Schema validates supported plans", "Invalid and adversarial plans are rejected", "Tests cover boundary cases"]
  },
  {
    "id": "T006",
    "title": "Browser model loading",
    "dependsOn": ["T001"],
    "objective": "Add explicit Launch local AI flow, browser/WebGPU checks, model download progress, cache messaging, and graceful failures using a verified browser-compatible model loaded from an external CORS-compatible artifact URL only after click.",
    "focus": ["src", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["No automatic large model download on landing", "Progress and failure states are visible", "Model choice is documented with evidence", "Model weights are not committed", "Persistent browser caching is used where supported"]
  },
  {
    "id": "T007",
    "title": "Model-to-plan integration",
    "dependsOn": ["T005", "T006"],
    "objective": "Connect model output to the structured plan schema, reject invalid plans, and execute only validated plans through DuckDB.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["LLM never executes raw SQL", "Invalid outputs produce safe UI errors", "Successful plans run deterministically"]
  },
  {
    "id": "T008",
    "title": "Charts and result explanations",
    "dependsOn": ["T004"],
    "objective": "Add interactive charts and concise deterministic result summaries that do not invent facts beyond query output.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Chart type follows validated plan", "Tables remain accessible", "Summaries are grounded in results"]
  },
  {
    "id": "T009",
    "title": "Open-data catalog",
    "dependsOn": ["T003C"],
    "objective": "Add a curated public/no-secret data catalog with suggested analytical questions and reliable browser-accessible sources. Validate asset and data URLs from the GitHub Pages production origin, not localhost alone.",
    "focus": ["src", "public", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Catalog includes included and public datasets", "Suggested questions map to supported operations", "No API keys are required", "Production Pages URLs are documented or tested"]
  },
  {
    "id": "T010",
    "title": "Upload workflow",
    "dependsOn": ["T003C", "T004"],
    "objective": "Support CSV and JSON upload, and Parquet upload when practical, with schema inspection and local-only data handling.",
    "focus": ["src"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Uploaded CSV can be analyzed", "Uploaded JSON can be inspected", "Local-only privacy claim is accurate"]
  },
  {
    "id": "T011",
    "title": "Security and red-team tests",
    "dependsOn": ["T005", "T007", "T010"],
    "objective": "Add tests and documentation for prompt injection, unsupported operations, malicious file contents, and privacy boundaries.",
    "focus": ["src", "docs", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Adversarial examples are rejected", "No secrets are committed", "Security boundaries are documented"]
  },
  {
    "id": "T012",
    "title": "Model evaluation harness",
    "dependsOn": ["T005", "T007"],
    "objective": "Create a lightweight evaluation harness for structured-output validity, task accuracy, hallucination checks, and unsupported-operation rejection.",
    "focus": ["eval", "src", "README.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Base model can be evaluated", "Metrics are recorded", "Failures are actionable"]
  },
  {
    "id": "T013",
    "title": "Custom-training pipeline",
    "dependsOn": ["T012"],
    "objective": "Create reproducible training docs and scripts for structured dataset-analysis planning without blocking the stock-model MVP.",
    "focus": ["training", "README.md", "docs"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Synthetic and hand-authored examples exist", "Splits and metrics are documented", "RTX 3070 constraints are respected"]
  },
  {
    "id": "T014",
    "title": "Portfolio documentation",
    "dependsOn": ["T002", "T007", "T008", "T010"],
    "objective": "Write README and docs covering setup, architecture, GitHub Pages deployment, external model artifact hosting, limitations, screenshots, and interview talking points.",
    "focus": ["README.md", "docs"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Interview talking points exist", "Limitations are honest", "Screenshots or reproducible screenshot steps are included", "Deployment remains approval-gated"]
  },
  {
    "id": "T015",
    "title": "Optional AWS/CDK architecture",
    "dependsOn": ["T014"],
    "objective": "Add optional AWS serverless architecture docs and a non-deployed CDK skeleton if appropriate.",
    "focus": ["docs", "infra"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["No AWS deployment occurs", "IAM and cost boundaries are documented", "Static GitHub Pages remains primary"]
  },
  {
    "id": "T016",
    "title": "Final QA and polish",
    "dependsOn": ["T011", "T012", "T013", "T014", "T015"],
    "objective": "Run final quality gates, create QA report, verify Git status, validate GitHub Pages production path assumptions, and polish user-facing rough edges.",
    "focus": ["README.md", "docs", "src", "QA_REPORT.md"],
    "validation": ["npm run typecheck", "npm run lint", "npm run test", "npm run build"],
    "acceptance": ["Final QA report exists", "All quality gates are addressed", "Any WebGPU manual checks are clearly documented", "Model, dataset, worker, and WebAssembly URLs are validated from the Pages path", "No deployment or push happens without approval"]
  }
]
```
