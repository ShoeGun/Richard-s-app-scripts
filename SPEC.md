# EdgeOps Agent Studio Specification

Build an interview-ready portfolio demonstration of a custom-trained, browser-native AI data-analysis agent.

The deliverable is a static React/TypeScript application integrated into the existing GitHub Pages portfolio repository `ShoeGun/ShoeGun.github.io`. It should demonstrate browser-side AI inference, deterministic analytics, structured output validation, robust tests, and clear interview talking points.

Do not push, publish, or deploy until Richard explicitly approves deployment.

## Core Application

- React, TypeScript, and Vite.
- Redux Toolkit where global state is justified.
- Web Worker separation for model inference and analytical execution.
- Transformers.js or another verified browser-compatible runtime.
- WebGPU inference entirely inside the visitor's browser.
- DuckDB-Wasm for deterministic dataset querying.
- Zod or equivalent validation for model-generated structured plans.
- Interactive charts.
- Responsive, accessible, portfolio-quality UI.
- GitHub Actions workflow for Pages deployment.
- Vite `base` configured for this user Pages repository. Default production base is `/`; support an override for project-repository paths if the hosting target changes.
- Client-side routing that works on GitHub Pages without server rewrites.

The language model interprets analytical requests and emits a strictly validated structured analysis plan. It must not calculate final statistics or freely execute arbitrary SQL. DuckDB-Wasm executes validated plans and returns deterministic results.

## Data Features

- Included demonstration datasets.
- CSV upload.
- JSON upload.
- Parquet upload when practical.
- At least one no-secret open-data source with reliable browser access.
- Curated data catalog.
- Dataset schema inspection.
- Suggested analytical questions.
- Filtering, grouping, aggregation, sorting, limits, and basic chart selection.

Prefer public sources such as Socrata, Data.gov, or curated static datasets. Data.world may be documented or included through an optional secure adapter, but no API keys may be embedded in the client.

## Browser Model Experience

- Explicit "Launch local AI" button.
- Explain the one-time model download before starting.
- Download progress and approximate size.
- Browser compatibility and WebGPU availability checks.
- Persistent browser caching.
- Graceful failure state.
- Clear statement that prompts and uploaded data remain on-device.
- Display model name, quantization, initialization time, inference speed, and approximate memory usage where measurable.
- Do not automatically download hundreds of megabytes on the landing view.
- Do not commit model weights or large binary artifacts to this repository.
- Store versioned model artifacts on Hugging Face Hub or another appropriate external artifact host with browser-compatible CORS behavior.
- Load model artifacts from the external URL only after the visitor clicks "Launch local AI".
- Persistently cache downloaded model artifacts in the browser where the chosen runtime supports it.

Start with a verified pretrained browser-compatible model so the app works before custom training. A model in the approximate 300M-1B range is preferred. Evaluate candidates by evidence, not assumption.

## Custom Training Workstream

After the stock-model vertical slice works, create a reproducible fine-tuning pipeline for structured dataset-analysis planning:

- Synthetic and hand-authored training examples.
- Train/validation/test splits.
- Strict structured-output examples.
- Invalid-request and adversarial examples.
- LoRA or QLoRA where appropriate.
- Local RTX 3070-compatible training settings when feasible.
- Optional remote-compute configuration.
- Export/merge pipeline.
- Browser-compatible ONNX or equivalent conversion.
- Quantization.
- Base-versus-tuned evaluation.
- Structured-output validity rate.
- Task accuracy.
- Hallucination and unsupported-operation tests.
- Model card and training documentation.

Training must not block delivery of the stock-model MVP.

## Portfolio And Interview Features

The project should visibly demonstrate React, TypeScript, Node tooling, Redux, browser-side AI inference, AI agents and tool calling, structured outputs, document/data processing, deterministic analytical execution, model evaluation, red-team testing, security boundaries, unit and integration testing, Git workflow, and serverless/AWS architecture understanding.

Include architecture documentation for an optional extension using CloudFront, S3, API Gateway, Lambda, DynamoDB, IAM, and AWS CDK. Do not deploy AWS resources or create costs.

## Quality Gates

The worker must not mark the project complete until:

- Type checking passes.
- Linting passes.
- Unit tests pass.
- Production build passes.
- GitHub Actions Pages workflow exists and builds the static artifact.
- Deployed artifact size is kept comfortably below GitHub Pages limits.
- All model, dataset, worker, and WebAssembly asset URLs are validated from the final GitHub Pages production path, not only localhost.
- Core application works locally.
- At least one included dataset can be analyzed.
- Uploaded CSV data can be analyzed.
- Structured plans are schema-validated.
- Unsupported operations are rejected.
- Model loading has visible progress and error handling.
- Browser data remains local.
- README includes setup, architecture, limitations, screenshots, and interview talking points.
- No secrets are committed.
- Git working tree is understood and intentionally committed.
- A final QA report exists.

Use Playwright for essential browser tests when practical. If automated WebGPU testing is unavailable, document and provide a reproducible manual validation procedure rather than claiming it passed.
