# EdgeOps Agent Orchestration Platform

## Control Surfaces

- Dashboard: `http://127.0.0.1:3210`
- Paperclip: `http://127.0.0.1:3100`
- Main Paperclip control issue: `RIC-10`
- Local execution ledger: `TASKS.md` and `WORKER_STATE.json`
- Human intent: `PLANS/ACTIVE_PLAN.md`, `PLANS/TEST_PATTERNS.md`, and `PLANS/GUARDRAILS.md`
- Detailed model research: `RESEARCH/local-model-routing-2026-07-23.md`
- Latest routing benchmark: `BENCHMARKS/local-model-routing-latest.json`

## State Ownership

There is one execution authority: the local ledger. Paperclip and the dashboard
project that state for management. This prevents two control systems from racing
to assign or complete the same task.

Paperclip owns goals, portfolio-level priorities, budgets, and human review.
Agentic OS owns workflow rules and evidence gates. The scheduled worker owns one
bounded task lease at a time. OpenClaw remains available for Paperclip-native
agents such as Night Operator; it does not duplicate the project-local worker.

## Work Loop

1. Richard edits the plan, tests, and guardrails in the dashboard.
2. The worker selects the first dependency-ready task.
3. The implementer receives retrieved task context, not the whole repository.
4. The proposal gate rejects directories, protected paths, out-of-focus files,
   invalid JSON, placeholders, duplicate paths, and oversized edits.
5. The worker snapshots only proposal-owned paths, applies edits, and runs the
   allowlisted validation commands.
6. A different local model reviews the scoped diff.
7. Passing work is committed with exact path staging. Failed work is restored.
8. Repair uses the stronger local coder.
9. Local escalation receives a compact failure packet.
10. Frontier guidance is used only after local recovery fails.
11. The bridge updates the parent Paperclip issue and the 16 child task issues.

## Token Policy

- Use 8K-16K retrieved context for normal work.
- Keep detailed logs out of prompts.
- Exact Ollama `prompt_eval_count` and `eval_count` values are recorded.
- Codex CLI calls are marked as estimates because the CLI does not expose the
  same counters to this worker.
- Compress handoffs into objective, constraints, decisions, paths, commands,
  blockers, and next action. Preserve links to full evidence.
- Do not spend frontier tokens on implementation that a local model can retry.
- Do not repeat a local model tier that failed the same contract without new
  evidence or guidance.

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File .\start-control-plane.ps1
powershell -ExecutionPolicy Bypass -File .\worker-status.ps1
powershell -ExecutionPolicy Bypass -File .\pause-worker.ps1
powershell -ExecutionPolicy Bypass -File .\resume-worker.ps1
powershell -ExecutionPolicy Bypass -File .\stop-worker.ps1
powershell -ExecutionPolicy Bypass -File .\sync-loop-once.ps1
node .\worker\benchmark-models.mjs
```

## Promotion Gate

A local model may enter automatic routing only when it:

- produces valid JSON under the worker contract;
- edits only focused files;
- never emits directory paths as file edits;
- detects seeded workflow/test regressions;
- beats or complements the current route on task success;
- has acceptable wall time and memory use on the RTX 3070 host.

The installed abliterated Qwen 3.5 9B remains experimental because it failed
both strict JSON benchmark cases. The installed Qwen 3 32B also remains manual
because its benchmark was unstable and slower. Neither is automatically safer
or more capable because of its alignment label or parameter count.
