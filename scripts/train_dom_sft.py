"""Optional Transformers/TRL LoRA trainer for a prepared Dom run."""

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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--base-model")
    args = parser.parse_args()
    try:
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from trl import SFTConfig, SFTTrainer
    except ImportError as exc:
        raise SystemExit("Training dependencies are not installed. Create the separate workbench environment and install training/requirements-training.txt.") from exc

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    target = manifest["baseModels"][args.target]
    base_model = args.base_model or target["id"]
    run_dir = Path(args.run_dir)
    rows = [json.loads(line) for line in (run_dir / "prepared" / "train.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    validation_path = run_dir / "prepared" / "validation.jsonl"
    validation_rows = [json.loads(line) for line in validation_path.read_text(encoding="utf-8").splitlines() if line.strip()] if validation_path.exists() else []
    tokenizer = AutoTokenizer.from_pretrained(base_model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def format_row(row: dict) -> str:
        messages = row["messages"]
        if not any(message.get("role") == "system" for message in messages):
            messages = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
        if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
            return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        return "\n".join(f"{message['role']}: {message['content']}" for message in messages)

    dataset = Dataset.from_dict({"text": [format_row(row) for row in rows]})
    validation_dataset = Dataset.from_dict({"text": [format_row(row) for row in validation_rows]}) if validation_rows else None
    output_dir = run_dir / args.target / "adapter"
    output_dir.mkdir(parents=True, exist_ok=True)
    use_cpu = args.target != "desktop-gpu"
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        device_map="auto" if not use_cpu else None,
        torch_dtype="auto",
    )
    lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")
    training_kwargs = {
        "output_dir": str(output_dir),
        "num_train_epochs": manifest["training"]["epochs"],
        "learning_rate": manifest["training"]["learningRate"],
        "per_device_train_batch_size": manifest["training"]["perDeviceBatchSize"],
        "gradient_accumulation_steps": manifest["training"]["gradientAccumulationSteps"],
        "max_length": manifest["training"]["maxSequenceLength"],
        "logging_steps": 1,
        # Keep only the final adapter on this small system; epoch checkpoints
        # quickly consume the available disk without improving evaluation.
        "save_strategy": "no",
        "report_to": [],
        "dataset_text_field": "text",
        "bf16": False,
        "fp16": False,
        "tf32": False,
        "use_cpu": use_cpu,
    }
    if validation_dataset is not None:
        training_kwargs["eval_strategy"] = "epoch"
    training_args = SFTConfig(
        **training_kwargs,
    )
    trainer = SFTTrainer(model=model, args=training_args, train_dataset=dataset, eval_dataset=validation_dataset, processing_class=tokenizer, peft_config=lora)
    train_result = trainer.train()
    evaluation_metrics = trainer.evaluate() if validation_dataset is not None else None
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    metrics = {
        "status": "trained",
        "target": args.target,
        "baseModel": base_model,
        "trainExamples": len(rows),
        "validationExamples": len(validation_rows),
        "train": train_result.metrics,
        "evaluation": evaluation_metrics,
        "logHistory": trainer.state.log_history,
    }
    (run_dir / args.target / "training-metrics.json").write_text(json.dumps(metrics, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"status": "trained", "target": args.target, "baseModel": base_model, "output": str(output_dir), "metrics": str(run_dir / args.target / "training-metrics.json")}, indent=2))


if __name__ == "__main__":
    main()
