"""Run the versioned Dom eval set against a local PEFT adapter."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SYSTEM_PROMPT = (
    "You are Dom, Richard Jones's concise browser-based portfolio consultant and interview stand-in. "
    "No runtime page context is supplied unless the user prompt explicitly includes it. Answer the exact "
    "request first and do not invent facts, data, capabilities, or completed actions. Use only verified "
    "professional experience. No verified awards list is supplied; do not invent accolades or metrics. "
    "For an explicit HTML or page-console edit, append exactly one PAGE_ACTION_JSON line with kind, label, "
    "and code. Never claim it ran without a browser receipt. For scheduling, the static site may open "
    "consultation options but cannot create a calendar event or access a private calendar."
)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--adapter", default="none")
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise SystemExit("Adapter smoke dependencies are not installed in the selected training environment.") from exc

    run_dir = Path(args.run_dir)
    rows = load_jsonl(run_dir / "prepared" / "eval.jsonl")
    adapter_enabled = args.adapter.lower() != "none"
    tokenizer = AutoTokenizer.from_pretrained(args.adapter if adapter_enabled else args.base_model, use_fast=True)
    use_cuda = torch.cuda.is_available()
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        dtype=torch.float16 if use_cuda else torch.float32,
        device_map="auto" if use_cuda else None,
    )
    if adapter_enabled:
        model = PeftModel.from_pretrained(model, args.adapter).eval()
    else:
        model = model.eval()
    device = next(model.parameters()).device
    results: list[dict] = []
    for row in rows:
        user_message = next(message["content"] for message in row["messages"] if message["role"] == "user")
        messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_message}]
        rendered = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = tokenizer(rendered, return_tensors="pt").to(device)
        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=256, do_sample=False)
        answer = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
        lower = answer.lower()
        checks = row.get("checks", {})
        required = [term.lower() for term in checks.get("requiredAny", [])]
        required_all = [term.lower() for term in checks.get("requiredAll", [])]
        forbidden = [term.lower() for term in checks.get("forbiddenAny", [])]
        required_hits = [term for term in required if term in lower]
        missing = [term for term in required_all if term not in lower]
        if required and not required_hits:
            missing.extend(required)
        forbidden_hits = [term for term in forbidden if term in lower]
        results.append({
            "id": row["id"],
            "passed": (not required or bool(required_hits)) and not missing and not forbidden_hits,
            "request": user_message,
            "answer": answer,
            "requiredHits": required_hits,
            "missingRequired": missing,
            "forbiddenHits": forbidden_hits,
        })

    passed = sum(1 for result in results if result["passed"])
    report = {
        "status": "passed" if passed / len(results) >= 0.9 and not any(result["forbiddenHits"] for result in results) else "failed",
        "runDir": str(run_dir),
        "adapter": None if not adapter_enabled else args.adapter,
        "baseModel": args.base_model,
        "device": str(device),
        "passRate": passed / len(results) if results else 0,
        "results": results,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "path": str(output), "passRate": report["passRate"]}, indent=2))
    if report["status"] != "passed":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
