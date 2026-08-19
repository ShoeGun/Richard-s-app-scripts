"""Create a reviewed, provenance-tagged Dom student pack from local GLM output.

This is behavioral distillation, not logit distillation. The teacher only sees
the versioned capability examples and a strict output contract. Held-out eval
examples are never sent to the teacher or included in the student pack.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACK = ROOT / "training" / "packs" / "dom-capabilities-101.jsonl"
DEFAULT_OUTPUT = Path(os.environ.get("DOM_MODEL_ARTIFACT_ROOT", str(Path.home() / "Projects" / "DomWorkbenchArtifacts")))
FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise SystemExit(f"{path}:{line_number}: expected an object")
        rows.append(value)
    return rows


def user_text(row: dict[str, Any]) -> str:
    return next((str(message.get("content", "")) for message in row.get("messages", []) if message.get("role") == "user"), "")


def assistant_text(row: dict[str, Any]) -> str:
    return next((str(message.get("content", "")) for message in row.get("messages", []) if message.get("role") == "assistant"), "")


def source_digest(row: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=True).encode("utf-8")).hexdigest()[:16]


def extract_json(text: str) -> dict[str, Any] | None:
    candidates = [text.strip()]
    candidates.extend(match.group(1).strip() for match in FENCE_RE.finditer(text))
    for candidate in candidates:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def response_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def request_teacher(endpoint: str, model: str, row: dict[str, Any], timeout: int, max_tokens: int, mode: str) -> tuple[str, str, str]:
    reference = assistant_text(row)
    must_keep_action = "PAGE_ACTION_JSON" in reference
    if mode == "review":
        system = (
            "You are GLM 5.2 acting as a teacher-reviewer for Dom, a small assistant embedded in Richard Jones's portfolio. "
            "Return JSON only with keys accept and notes. Decide whether the supplied reference answer is fit for student training. "
            "Accept only if it answers the request, stays portfolio-only, does not invent tools or facts, and preserves the exact "
            "PAGE_ACTION_JSON contract when present. Reject unsupported terminal, credential, scheduling, or execution claims. "
            "Keep notes under 20 words."
        )
        output_shape = {"accept": "true or false", "notes": "short string"}
    else:
        system = (
            "You are GLM 5.2 acting as a teacher for Dom, a small assistant embedded in Richard Jones's portfolio. "
            "Return JSON only with keys assistant, decision, and notes. Rewrite one student answer from the supplied example. "
            "Use only the supplied reference and request. Do not invent tools, facts, selectors, receipts, credentials, terminal access, "
            "scheduling abilities, or private data. Keep the visitor-facing voice concise. "
            "PAGE_ACTION_JSON must be a single valid action proposal when the reference uses it. "
            "For receipt questions, never claim execution without a host receipt."
        )
        output_shape = {"assistant": "string", "decision": "keep or rewrite", "notes": "short string"}
    user = json.dumps({
        "request": user_text(row),
        "reference_answer": reference,
        "must_preserve_page_action_json": must_keep_action,
        "output_shape": output_shape,
    }, ensure_ascii=True)
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    parsed = extract_json(response_text(json.loads(raw)))
    if not parsed:
        raise ValueError("teacher response was not JSON")
    notes = str(parsed.get("notes", ""))[:240]
    if mode == "review":
        accepted = parsed.get("accept") is True or str(parsed.get("accept", "")).lower() == "true"
        return reference, "accept" if accepted else "reject", notes
    if not isinstance(parsed.get("assistant"), str) or not parsed["assistant"].strip():
        raise ValueError("teacher response did not contain a JSON assistant string")
    answer = parsed["assistant"].strip()
    if must_keep_action and "PAGE_ACTION_JSON" not in answer:
        raise ValueError("teacher removed the required PAGE_ACTION_JSON contract")
    if re.search(r"\b(?:PowerShell|terminal command|private key|api key|bearer)\b", answer, re.IGNORECASE):
        raise ValueError("teacher introduced a forbidden private-terminal or credential claim")
    decision = str(parsed.get("decision", "rewrite"))[:40]
    return answer, decision, notes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-pack", type=Path, default=DEFAULT_PACK)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--endpoint", default=os.environ.get("COLIBRI_URL", "http://127.0.0.1:1236/v1/chat/completions"))
    parser.add_argument("--model", default="glm-5.2-colibri")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--ids", help="Comma-separated source IDs; overrides --limit")
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument("--max-tokens", type=int, default=96)
    parser.add_argument("--mode", choices=("review", "rewrite"), default="review")
    parser.add_argument("--sleep-seconds", type=float, default=1.0)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be positive")

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    result_path = output / "teacher-results.jsonl"
    student_path = output / "student-pack.jsonl"
    manifest_path = output / "distillation-manifest.json"
    source_rows = load_jsonl(args.source_pack.resolve())
    requested_ids = [item.strip() for item in (args.ids or "").split(",") if item.strip()]
    if requested_ids:
        by_id = {str(row.get("id")): row for row in source_rows}
        missing = [item for item in requested_ids if item not in by_id]
        if missing:
            raise SystemExit(f"Unknown source IDs: {', '.join(missing)}")
        rows = [by_id[item] for item in requested_ids]
    else:
        rows = source_rows[: args.limit]
    previous: dict[str, dict[str, Any]] = {}
    if args.resume and result_path.exists():
        for row in load_jsonl(result_path):
            previous[str(row.get("sourceId"))] = row

    results: list[dict[str, Any]] = []
    student_rows: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        source_id = str(row.get("id", f"row-{index}"))
        cached = previous.get(source_id)
        if cached and cached.get("status") == "accepted":
            result = cached
        else:
            started = time.monotonic()
            try:
                answer, decision, notes = request_teacher(args.endpoint, args.model, row, args.timeout, args.max_tokens, args.mode)
                result = {
                    "sourceId": source_id,
                    "sourceDigest": source_digest(row),
                    "status": "accepted",
                    "decision": decision,
                    "answer": answer,
                    "notes": notes,
                    "elapsedSeconds": round(time.monotonic() - started, 2),
                    "recordedAt": now(),
                }
            except Exception as exc:
                result = {
                    "sourceId": source_id,
                    "sourceDigest": source_digest(row),
                    "status": "rejected",
                    "error": f"{type(exc).__name__}: {exc}",
                    "elapsedSeconds": round(time.monotonic() - started, 2),
                    "recordedAt": now(),
                }
        results = [item for item in results if item.get("sourceId") != source_id]
        results.append(result)
        result_path.write_text("\n".join(json.dumps(item, ensure_ascii=True) for item in results) + "\n", encoding="utf-8")
        if result.get("status") == "accepted":
            student_rows.append({
                "id": f"glm-distill-{source_id}",
                "sourceId": source_id,
                "teacher": args.model,
                "messages": [
                    {"role": message["role"], "content": message["content"]}
                    for message in row.get("messages", [])
                    if message.get("role") in {"system", "user"}
                ] + [{"role": "assistant", "content": result["answer"]}],
            })
        print(json.dumps({"index": index, "total": len(rows), "sourceId": source_id, "status": result.get("status")}, ensure_ascii=True), flush=True)
        if args.sleep_seconds and index < len(rows):
            time.sleep(args.sleep_seconds)

    student_path.write_text("\n".join(json.dumps(item, ensure_ascii=True) for item in student_rows) + ("\n" if student_rows else ""), encoding="utf-8")
    manifest = {
        "createdAt": now(),
        "kind": "behavioral-distillation",
        "mode": args.mode,
        "teacher": args.model,
        "endpoint": args.endpoint,
        "sourcePack": str(args.source_pack.resolve()),
        "sourceLimit": args.limit,
        "sourceRows": len(rows),
        "acceptedRows": len(student_rows),
        "rejectedRows": len(rows) - len(student_rows),
        "studentPack": str(student_path),
        "teacherResults": str(result_path),
        "heldOutEvalPolicy": "untouched; no eval rows were sent to the teacher",
        "contract": "PAGE_ACTION_JSON is preserved when present; forbidden private-terminal and credential claims are rejected",
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    if not student_rows:
        raise SystemExit("No teacher examples were accepted.")


if __name__ == "__main__":
    main()
