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
