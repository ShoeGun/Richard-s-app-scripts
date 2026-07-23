# Extra Guardrails

Paste project-specific safety, style, review, deployment, and token-saving rules here.

Current defaults:

- Do not push or deploy without explicit approval.
- Do not commit model weights or large binary artifacts.
- Keep GitHub Pages static hosting compatibility.
- Prefer small, reviewable commits.
- Escalate with a compact request instead of looping indefinitely.
- Use only one frontier escalation tier per local failure cycle.
- Frontier escalation agents provide guidance only; local worker applies changes.
- Restore files touched by failed local attempts before retrying or escalating.
