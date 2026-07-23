# Escalations

Generated escalation artifacts are ignored by Git:

- `outbox/` - compact unblock requests for ChatGPT or another reviewer.
- `inbox/` - answers to consume. Save as `<TASK_ID>.md`, for example `T001.md`.
- `processed/` - consumed answers.
- `local/` - local escalation model outputs.

Manual frontier flow:

1. Open the latest file in `ESCALATIONS/outbox/`.
2. Paste it into ChatGPT 5.4 or another frontier model.
3. Save the answer:

```powershell
powershell -ExecutionPolicy Bypass -File .\answer-escalation.ps1 -TaskId T001 -FromClipboard
```

4. Resume the worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\resume-worker.ps1
```

Local model escalation flow:

```powershell
powershell -ExecutionPolicy Bypass -File .\ask-local-escalation.ps1 -TaskId T001 -Channel qwen-coder-local
```

