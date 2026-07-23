# Local Qwen Worker Handoff

Project path: `C:\Users\Richard\Projects\ShoeGun.github.io`

Branch: `qwen/edgeops-agent-studio`

Remote: `https://github.com/ShoeGun/ShoeGun.github.io.git`

Primary model: `qwen3:8b`

Fallback model: `qwen2.5-coder:7b`

Use these commands from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\worker-status.ps1
powershell -ExecutionPolicy Bypass -File .\start-worker.ps1
powershell -ExecutionPolicy Bypass -File .\pause-worker.ps1
powershell -ExecutionPolicy Bypass -File .\resume-worker.ps1
powershell -ExecutionPolicy Bypass -File .\stop-worker.ps1
powershell -ExecutionPolicy Bypass -File .\worker-doctor.ps1
```

The worker reads `TASKS.md` for the task queue and `WORKER_STATE.json` for compact persistent state. Detailed logs are stored under ignored `worker/logs/`.

Do not push or publish Pages changes until Richard explicitly approves deployment. This repository is a user GitHub Pages site, so Vite should default to `base: "/"`.

Local-first escalation loop:

- Put detailed plans in `PLANS/ACTIVE_PLAN.md`.
- Put tests in `PLANS/TEST_PATTERNS.md`.
- Put extra constraints in `PLANS/GUARDRAILS.md`.
- Failed local edit attempts restore touched files before retry/escalation.
- Escalation requests are generated under `ESCALATIONS/outbox/`.
- Default auto ladder is `gpt-5.4` then `gpt-5.6`; both run via `codex exec` in read-only mode and save compact answers under `ESCALATIONS/frontier/`.
- Manual answers can still be saved under `ESCALATIONS/inbox/<TASK_ID>.md`.
- Use `show-escalation-config.ps1`, `set-escalation-ladder.ps1`, `add-local-escalation-channel.ps1`, and `add-frontier-escalation-channel.ps1` to change the ladder.
- See `LOOPS/LOCAL_FIRST_ESCALATION.md`.
