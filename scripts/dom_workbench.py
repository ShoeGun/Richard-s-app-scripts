"""Dependency-light orchestration for the Dom distillation workbench."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "training" / "dom-workbench.json"
SECRET_PATTERN = re.compile(r"(?:sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=])", re.I)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: expected an object")
        rows.append(value)
    return rows


def validate_messages(value: dict[str, Any], source: Path, index: int, max_chars: int, eval_pack: bool = False) -> list[str]:
    errors: list[str] = []
    example_id = value.get("id")
    if not isinstance(example_id, str) or not example_id.strip():
        errors.append(f"{source}:{index}: missing id")
    messages = value.get("messages")
    if not isinstance(messages, list) or not messages:
        errors.append(f"{source}:{index}: messages must be a non-empty list")
        return errors
    total_chars = 0
    roles: list[str] = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {"system", "user", "assistant"}:
            errors.append(f"{source}:{index}: invalid message role")
            continue
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            errors.append(f"{source}:{index}: message content must be non-empty text")
            continue
        roles.append(message["role"])
        total_chars += len(content)
        if SECRET_PATTERN.search(content):
            errors.append(f"{source}:{index}: possible secret-like text")
    if "user" not in roles or (not eval_pack and "assistant" not in roles):
        required = "user" if eval_pack else "user and assistant"
        errors.append(f"{source}:{index}: example needs {required} messages")
    if total_chars > max_chars:
        errors.append(f"{source}:{index}: {total_chars} chars exceeds {max_chars}")
    return errors


def validate_pack(path: Path, max_chars: int, eval_pack: bool = False) -> tuple[list[dict[str, Any]], list[str]]:
    rows = load_jsonl(path)
    errors: list[str] = []
    ids: set[str] = set()
    for index, row in enumerate(rows, 1):
        errors.extend(validate_messages(row, path, index, max_chars, eval_pack))
        row_id = row.get("id")
        if isinstance(row_id, str):
            if row_id in ids:
                errors.append(f"{path}:{index}: duplicate id {row_id}")
            ids.add(row_id)
        if eval_pack and not isinstance(row.get("checks"), dict):
            errors.append(f"{path}:{index}: eval example needs checks")
    return rows, errors


def artifact_root() -> Path:
    return Path(os.environ.get("DOM_MODEL_ARTIFACT_ROOT", str(Path.home() / "Projects" / "DomWorkbenchArtifacts")))


def run_dir(run_id: str) -> Path:
    return artifact_root() / "runs" / run_id


def load_manifest() -> dict[str, Any]:
    return load_json(MANIFEST_PATH)


def skill_data(manifest: dict[str, Any], skill: str | None) -> dict[str, Any]:
    data = dict(manifest["data"])
    if not skill:
        return data
    selected = manifest.get("skills", {}).get(skill)
    if not isinstance(selected, dict):
        available = ", ".join(sorted(manifest.get("skills", {}))) or "(none)"
        raise ValueError(f"Unknown training skill '{skill}'. Available skills: {available}")
    if "capabilityPacks" in selected:
        data["capabilityPacks"] = list(selected["capabilityPacks"])
        data["capabilityPack"] = data["capabilityPacks"][0]
    else:
        data["capabilityPacks"] = [selected["capabilityPack"]]
        data["capabilityPack"] = selected["capabilityPack"]
    if "evaluationSets" in selected:
        data["evaluationSets"] = list(selected["evaluationSets"])
        data["evaluationSet"] = data["evaluationSets"][0]
    else:
        data["evaluationSets"] = [selected["evaluationSet"]]
        data["evaluationSet"] = selected["evaluationSet"]
    return data


def data_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def dataset_paths(data: dict[str, Any], kind: str, override: str | None = None) -> list[Path]:
    if override:
        return [data_path(override)]
    plural_key = f"{kind}s"
    values = data.get(plural_key) or [data[kind]]
    if isinstance(values, str):
        values = [values]
    return [data_path(str(value)) for value in values]


def load_combined_jsonl(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        rows.extend(load_jsonl(path))
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("\n".join(json.dumps(row, ensure_ascii=True) for row in rows) + "\n", encoding="utf-8")


def deterministic_split(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Create a repeatable train/validation split without leaking the held-out eval set."""
    ordered = sorted(rows, key=lambda row: str(row.get("id", "")))
    if len(ordered) < 10:
        return ordered, [], {"strategy": "train-only-small-pack", "seed": "stable-id-sha256", "warning": "Fewer than 10 examples; no validation split was created."}
    validation_count = max(1, round(len(ordered) * 0.2))
    ranked = sorted(ordered, key=lambda row: hashlib.sha256(str(row.get("id", "")).encode("utf-8")).hexdigest())
    validation_ids = {str(row.get("id")) for row in ranked[:validation_count]}
    validation_rows = [row for row in ordered if str(row.get("id")) in validation_ids]
    train_rows = [row for row in ordered if str(row.get("id")) not in validation_ids]
    return train_rows, validation_rows, {"strategy": "stable-id-sha256", "seed": "stable-id-sha256", "train": len(train_rows), "validation": len(validation_rows), "validationIds": sorted(validation_ids)}


def validate(skill: str | None = None, pack_override: str | None = None, eval_override: str | None = None) -> dict[str, Any]:
    manifest = load_manifest()
    data = skill_data(manifest, skill)
    pack_paths = dataset_paths(data, "capabilityPack", pack_override)
    eval_paths = dataset_paths(data, "evaluationSet", eval_override)
    pack: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    pack_errors: list[str] = []
    eval_errors: list[str] = []
    for pack_path in pack_paths:
        rows, errors = validate_pack(pack_path, int(data["maxExampleChars"]))
        pack.extend(rows)
        pack_errors.extend(errors)
    for eval_path in eval_paths:
        rows, errors = validate_pack(eval_path, int(data["maxExampleChars"]), True)
        eval_rows.extend(rows)
        eval_errors.extend(errors)
    for label, rows, errors in [("capability", pack, pack_errors), ("evaluation", eval_rows, eval_errors)]:
        seen: set[str] = set()
        for row in rows:
            row_id = str(row.get("id", ""))
            if row_id in seen:
                errors.append(f"{label}: duplicate id across combined packs: {row_id}")
            seen.add(row_id)
    result = {
        "status": "passed" if not pack_errors and not eval_errors else "failed",
        "capabilityExamples": len(pack),
        "evaluationExamples": len(eval_rows),
        "errors": pack_errors + eval_errors,
        "manifest": str(MANIFEST_PATH),
    }
    if skill:
        result["skill"] = skill
    result["capabilityPacks"] = [str(path) for path in pack_paths]
    result["evaluationSets"] = [str(path) for path in eval_paths]
    print(json.dumps(result, indent=2))
    if result["status"] != "passed":
        raise SystemExit(2)
    return result


def prepare(run_id: str, skill: str | None = None, pack_override: str | None = None, eval_override: str | None = None, dataset_name: str | None = None) -> Path:
    validate(skill, pack_override, eval_override)
    manifest = load_manifest()
    data = skill_data(manifest, skill)
    pack_paths = dataset_paths(data, "capabilityPack", pack_override)
    eval_paths = dataset_paths(data, "evaluationSet", eval_override)
    data["capabilityPacks"] = [str(path) for path in pack_paths]
    data["capabilityPack"] = str(pack_paths[0])
    data["evaluationSets"] = [str(path) for path in eval_paths]
    data["evaluationSet"] = str(eval_paths[0])
    manifest["data"] = data
    if skill:
        manifest["selectedSkill"] = skill
        skill_training = manifest.get("skills", {}).get(skill, {}).get("training")
        if isinstance(skill_training, dict):
            manifest["training"] = {**manifest["training"], **skill_training}
    output = run_dir(run_id)
    prepared = output / "prepared"
    prepared.mkdir(parents=True, exist_ok=True)
    pack = load_combined_jsonl(pack_paths)
    eval_rows = load_combined_jsonl(eval_paths)
    if data.get("deduplicate", True):
        pack = list({row["id"]: row for row in pack}.values())
    train_rows, validation_rows, split = deterministic_split(pack)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if dataset_name:
        (output / "dataset.json").write_text(json.dumps({"name": dataset_name, "source": str(pack_paths[0]), "sources": [str(path) for path in pack_paths]}, indent=2), encoding="utf-8")
    write_jsonl(prepared / "train.jsonl", train_rows)
    write_jsonl(prepared / "validation.jsonl", validation_rows)
    write_jsonl(prepared / "eval.jsonl", eval_rows)
    split_record = {"status": "passed", "sourceExamples": len(pack), "train": len(train_rows), "validation": len(validation_rows), "eval": len(eval_rows), "split": split}
    (output / "splits.json").write_text(json.dumps(split_record, indent=2), encoding="utf-8")
    (output / "validation.json").write_text(json.dumps(split_record, indent=2), encoding="utf-8")
    print(json.dumps({"status": "prepared", "runId": run_id, "path": str(output), "train": len(train_rows), "validation": len(validation_rows), "eval": len(eval_rows)}, indent=2))
    return output


def response_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def streamed_response(response: Any) -> str:
    chunks: list[str] = []
    fallback: dict[str, Any] | None = None
    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        fallback = payload
        choices = payload.get("choices") or []
        if choices:
            choice = choices[0]
            delta = choice.get("delta") or {}
            chunks.append(str(delta.get("content", "")))
    if chunks:
        return "".join(chunks)
    return response_text(fallback or {})


def glm_plan(run_id: str, endpoint: str | None, timeout_seconds: int | None = None) -> Path:
    output = run_dir(run_id)
    if not (output / "manifest.json").exists():
        prepare(run_id)
    manifest = load_manifest()
    selected_data = skill_data(manifest, manifest.get("selectedSkill"))
    eval_rows = load_combined_jsonl(dataset_paths(selected_data, "evaluationSet"))
    prompt = {
        "role": "local_workbench_lead",
        "goal": "Plan the first bounded SFT/LoRA pass for Dom's browser models.",
        "constraints": [
            "Use only the versioned capability pack and evaluation IDs.",
            "Keep the browser runtime context-free by default; preserve explicit opt-in context.",
            "Do not train private data, credentials, volatile DOM selectors, or arbitrary terminal access.",
            "Recommend the smallest useful experiment and its acceptance checks.",
        ],
        "targets": manifest["baseModels"],
        "training": manifest["training"],
        "evaluationIds": [row["id"] for row in eval_rows],
        "outputSchema": ["hypothesis", "data_changes", "training_changes", "target_order", "checks", "stop_condition"],
    }
    endpoint = endpoint or os.environ.get("COLIBRI_URL", manifest["review"]["defaultEndpoint"])
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({
            "model": manifest["review"]["planner"],
            "messages": [
                {"role": "system", "content": "You are the local GLM lead for a small-model workbench. Return concise JSON only. Do not invent measurements."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=True)},
            ],
            "max_tokens": manifest["review"]["maxTokens"],
            "temperature": manifest["review"]["temperature"],
            "stream": True,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    record: dict[str, Any] = {"endpoint": endpoint, "requestedAt": now(), "request": prompt, "status": "pending"}
    path = output / "glm-lead.json"
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    request_timeout = timeout_seconds or int(os.environ.get("DOM_GLM_TIMEOUT_SECONDS", str(manifest["review"].get("timeoutSeconds", 7200))))
    try:
        with urllib.request.urlopen(request, timeout=request_timeout) as response:
            record["response"] = streamed_response(response)
            payload = {"streamed": True}
        record["status"] = "received"
        record["raw"] = payload
    except Exception as exc:  # keep a reviewable blocked artifact
        record["status"] = "blocked"
        record["error"] = f"{type(exc).__name__}: {exc}"
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps({"status": record["status"], "path": str(path), "endpoint": endpoint}, indent=2))
    if record["status"] == "blocked":
        raise SystemExit(3)
    return path


def evaluate(run_id: str, target: str, endpoint: str | None, skill: str | None = None) -> Path:
    output = run_dir(run_id)
    if not (output / "prepared" / "eval.jsonl").exists():
        prepare(run_id, skill)
    rows = load_jsonl(output / "prepared" / "eval.jsonl")
    manifest = load_manifest()
    report: dict[str, Any] = {"runId": run_id, "target": target, "status": "not-run", "results": []}
    endpoint = endpoint or os.environ.get("DOM_EVAL_ENDPOINT")
    if not endpoint:
        report["reason"] = "No DOM_EVAL_ENDPOINT supplied; structural pack validation completed only."
    else:
        for row in rows:
            user_message = next(message["content"] for message in row["messages"] if message["role"] == "user")
            request = urllib.request.Request(endpoint, data=json.dumps({"messages": row["messages"], "max_tokens": 128, "temperature": 0}).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=int(os.environ.get("DOM_GLM_EVAL_TIMEOUT_SECONDS", str(manifest["review"].get("timeoutSeconds", 7200))))) as response:
                    answer = response_text(json.loads(response.read().decode("utf-8")))
                checks = row["checks"]
                lower = answer.lower()
                required = [term.lower() for term in checks.get("requiredAny", [])]
                forbidden = [term.lower() for term in checks.get("forbiddenAny", [])]
                passed = (not required or any(term in lower for term in required)) and not any(term in lower for term in forbidden)
                report["results"].append({"id": row["id"], "passed": passed, "request": user_message, "answer": answer[:2000]})
            except Exception as exc:
                report["results"].append({"id": row["id"], "passed": False, "error": f"{type(exc).__name__}: {exc}"})
        total = len(report["results"])
        passed = sum(1 for result in report["results"] if result.get("passed"))
        report["passRate"] = passed / total if total else 0
        report["status"] = "passed" if report["passRate"] >= 0.9 else "failed"
    path = output / "eval.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "path": str(path), "passRate": report.get("passRate")}, indent=2))
    if report["status"] == "failed":
        raise SystemExit(2)
    return path


def package(run_id: str, target: str) -> Path:
    output = run_dir(run_id)
    adapter = output / target / "adapter"
    files = []
    if adapter.exists():
        for path in sorted(adapter.rglob("*")):
            if path.is_file():
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                files.append({"path": str(path.relative_to(adapter)), "bytes": path.stat().st_size, "sha256": digest})
    record = {"runId": run_id, "target": target, "artifactPolicy": "external-only", "files": files, "createdAt": now()}
    path = output / target / "artifact-manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps({"status": "packaged", "path": str(path), "files": len(files)}, indent=2))
    return path


def smoke(run_id: str, target: str, base_model: str | None = None, base_only: bool = False) -> None:
    output = run_dir(run_id)
    if not (output / "prepared" / "eval.jsonl").exists():
        prepare(run_id)
    manifest = load_manifest()
    base_model = base_model or manifest["baseModels"][target]["id"]
    adapter = output / target / "adapter"
    report = output / target / ("base-smoke.json" if base_only else "smoke.json")
    command = [
        sys.executable,
        str(ROOT / "scripts" / "dom_adapter_smoke.py"),
        "--run-dir", str(output),
        "--adapter", "none" if base_only else str(adapter),
        "--base-model", base_model,
        "--output", str(report),
    ]
    print(json.dumps({"status": "starting", "command": command}, indent=2))
    subprocess.run(command, check=True)


def train(run_id: str, target: str, base_model: str | None, skill: str | None = None) -> None:
    output = run_dir(run_id)
    if not (output / "prepared" / "train.jsonl").exists():
        prepare(run_id, skill)
    run_manifest = output / "manifest.json"
    command = [sys.executable, str(ROOT / "scripts" / "train_dom_sft.py"), "--manifest", str(run_manifest if run_manifest.exists() else MANIFEST_PATH), "--run-dir", str(output), "--target", target]
    if base_model:
        command.extend(["--base-model", base_model])
    print(json.dumps({"status": "starting", "command": command}, indent=2))
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("--skill")
    validate_parser.add_argument("--pack")
    validate_parser.add_argument("--eval")
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("--run-id", default=f"dom-{now()}")
    prepare_parser.add_argument("--skill")
    prepare_parser.add_argument("--pack")
    prepare_parser.add_argument("--eval")
    prepare_parser.add_argument("--dataset-name")
    plan_parser = sub.add_parser("plan")
    plan_parser.add_argument("--run-id", default=f"dom-{now()}")
    plan_parser.add_argument("--endpoint")
    plan_parser.add_argument("--timeout-seconds", type=int)
    train_parser = sub.add_parser("train")
    train_parser.add_argument("--run-id", required=True)
    train_parser.add_argument("--target", choices=["desktop-gpu", "desktop-cpu", "mobile"], required=True)
    train_parser.add_argument("--base-model")
    train_parser.add_argument("--skill")
    eval_parser = sub.add_parser("evaluate")
    eval_parser.add_argument("--run-id", required=True)
    eval_parser.add_argument("--target", required=True)
    eval_parser.add_argument("--endpoint")
    eval_parser.add_argument("--skill")
    package_parser = sub.add_parser("package")
    package_parser.add_argument("--run-id", required=True)
    package_parser.add_argument("--target", required=True)
    smoke_parser = sub.add_parser("smoke")
    smoke_parser.add_argument("--run-id", required=True)
    smoke_parser.add_argument("--target", choices=["desktop-gpu", "desktop-cpu", "mobile"], required=True)
    smoke_parser.add_argument("--base-model")
    smoke_parser.add_argument("--base-only", action="store_true")
    args = parser.parse_args()
    if args.command == "validate": validate(args.skill, args.pack, args.eval)
    elif args.command == "prepare": prepare(args.run_id, args.skill, args.pack, args.eval, args.dataset_name)
    elif args.command == "plan": glm_plan(args.run_id, args.endpoint, args.timeout_seconds)
    elif args.command == "train": train(args.run_id, args.target, args.base_model, args.skill)
    elif args.command == "evaluate": evaluate(args.run_id, args.target, args.endpoint, args.skill)
    elif args.command == "package": package(args.run_id, args.target)
    elif args.command == "smoke": smoke(args.run_id, args.target, args.base_model, args.base_only)


if __name__ == "__main__":
    main()
