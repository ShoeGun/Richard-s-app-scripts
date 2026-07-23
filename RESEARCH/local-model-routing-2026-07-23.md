# Local-model routing for agentic portfolio development

**Research date:** 2026-07-23
**Target host:** Windows, NVIDIA RTX 3070 8 GB VRAM, 64 GB system RAM
**Scope:** coding agents, tool calls, schema-constrained output, review, context compression, and escalation. Sources are first-party model cards, repositories, papers, and runtime documentation. Vendor benchmark numbers are useful screening evidence, not directly comparable measurements.

## Executive recommendation

Use a portfolio, not one model:

1. **Browser planner:** fine-tune and export **FunctionGemma 270M** for the narrow analysis-plan schema; keep deterministic validation and DuckDB execution outside the model. Also benchmark **Qwen3.5 0.8B** as the stronger but larger browser candidate.
2. **Fast desktop worker/router:** **Qwen3.5 4B** at `Q4_K_M`, 8K-16K working context. Keep **Phi-4-mini-instruct** or **NVIDIA Nemotron 3 Nano 4B** as an independent comparison.
3. **Default coding/tool worker:** **Qwen3.5 9B** text-only at `Q4_K_M`, initially 8K context. It is the best first replacement to test against the current `qwen3:8b`: current, Apache-2.0, strong first-party coding/agent results, native tool-call support, and still near the full-GPU boundary.
4. **Slow local reviewer/recovery lane:** benchmark **Devstral Small 2 24B**, **GLM-4.7-Flash 30B-A3B**, and **gpt-oss-20b** with partial GPU offload and 16K-32K context. Expect RAM-assisted, materially slower inference. Select one by the repository benchmark below; do not route ordinary edits here.
5. **Frontier escalation:** after two independent local failures, failed recovery, security-sensitive changes, or an inconclusive review, package the failing test, minimal diff, constraints, and prior attempts for a frontier model. Keep execution and approval local.

This host should not chase advertised 128K-1M windows. Context consumes memory beyond the weights; Ollama itself defaults systems below 24 GiB VRAM to 4K and notes that larger contexts require more memory. Treat 8K-16K as the fast operating range and retrieve only relevant files; reserve 32K+ for measured, RAM-assisted runs ([Ollama context documentation](https://docs.ollama.com/context-length)).

## What fits this machine

`Q4_K_M` is the sensible starting quantization for code. The llama.cpp project supports CUDA, CPU/GPU hybrid inference, and 1.5- through 8-bit quantization; its own example puts Llama 3.1 8B at **4.9 GiB** in `Q4_K_M` ([llama.cpp README](https://github.com/ggml-org/llama.cpp), [quantization guide](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)). Prefer `Q5_K_M` only when weights, KV cache, and compute buffers still fit. Avoid sub-4-bit quants for the primary coding lane until the benchmark proves they preserve patch and schema accuracy.

Approximate planning sizes below are inferences from parameter count and typical GGUF overhead, not promises:

| Class | Typical quantized weights | Practical behavior on 8 GB VRAM |
| --- | ---: | --- |
| 3B-4B dense | 2.2-3.2 GB at Q4/Q5 | Comfortable full offload; useful KV headroom |
| 8B-9B dense | 4.9-6.2 GB at Q4 | Usually full offload at modest context; 9B is close to the boundary |
| 14B-16B dense/MoE-total | 8.5-10.5 GB at Q4 | Partial offload; system RAM required |
| 20B-24B total | 12-16 GB | RAM-assisted review lane, not interactive default |
| 30B-35B total | 18-22 GB | Slow partial offload despite only ~3B active experts |
| 80B total | roughly 45-50 GB | Technically RAM-sized, operationally poor on this host |

For MoE models, **active parameters predict per-token compute better than memory**. All experts' weights still have to reside in VRAM and/or RAM. Thus `30B-A3B` is not a 3B download and `80B-A3B` is not an 8 GB model.

Use text-only checkpoints or disable the vision tower for coding when the runtime permits it. Start each model at 8K, record peak VRAM/RAM and tokens/second, then try 16K. Verify Ollama placement with `ollama ps`; avoid Windows "system memory fallback" as a hidden default because it can make an apparently loaded model unpredictably slow. llama.cpp exposes explicit layer offload and reports weights, KV cache, and compute buffers separately.

## Model-family assessment

| Family / candidate | First-party facts | Fit and recommended role |
| --- | --- | --- |
| **Qwen: Qwen3.5 4B / 9B** | Apache-2.0; native 262,144-token context; thinking mode, coding, agents, and tool-call parser support. Qwen reports 9B scores of 65.6 LiveCodeBench v6 and 66.1 BFCL-v4; 4B scores 55.8 and 50.3 respectively. The card explicitly recommends reducing context on OOM and offers text-only serving ([9B model card](https://huggingface.co/Qwen/Qwen3.5-9B), [4B model card](https://huggingface.co/Qwen/Qwen3.5-4B)). | **Best first tests.** 4B for routing/compression/schema repair; 9B for default coding and tools. The native window is not practical on 8 GB. Disable thinking for routine extraction; enable bounded thinking for repair/review. |
| **Qwen: Qwen3.6 35B-A3B / Qwen3-Coder-Next** | Qwen3.6 is 35B total/3B active and Apache-2.0. Qwen3-Coder-Next is 80B total/3B active, 256K context, and explicitly trained for long-horizon coding, tool use, and failure recovery ([Qwen3.6 card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B), [Coder-Next card](https://huggingface.co/Qwen/Qwen3-Coder-Next)). | Qwen3.6 is a plausible slow review candidate after GGUF support is verified. Coder-Next is too weight-heavy for this workstation's routine use despite its low active count. |
| **Gemma: Gemma 4 E4B / FunctionGemma 270M** | Gemma 4 E4B is Apache-2.0, supports a 128K window, built-in reasoning, coding, and native function calling ([Gemma 4 E4B card](https://huggingface.co/google/gemma-4-E4B-it)). FunctionGemma is a 270M Gemma-licensed, 32K function-call specialist intended to be fine-tuned for a specific task, not used as a general dialogue model ([FunctionGemma card](https://huggingface.co/google/functiongemma-270m-it)). | Gemma 4 E4B deserves a fast-lane benchmark once mature GGUF/runtime support is confirmed. FunctionGemma is unusually well matched to the portfolio's browser-side plan compiler after domain tuning; it is not the desktop coding worker. |
| **Llama: Llama 3.1 8B Instruct** | 8B, 128K, tool-use chat templates, gated weights, and the custom Llama 3.1 Community License plus acceptable-use policy ([Meta model card](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct), [official model repository](https://github.com/meta-llama/llama-models)). | Mature runtime compatibility and a useful control model, but older and not the leading choice here. Retain only if its local reliability beats newer models. Llama 4's smallest official variant is far too weight-heavy for this host. |
| **Mistral: Ministral 3 8B / Devstral Small 2 24B** | Both are Apache-2.0. Ministral 3 offers current 8B instruct/reasoning variants. Devstral Small 2 is a 24B FP8 code-agent model with tools, multi-file editing, 256K context, and a vendor-reported 68.0% SWE-bench Verified score; Mistral says it targets a 4090 or 32 GB Mac ([Ministral 3 8B card](https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512), [Devstral card](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512)). | Benchmark Ministral against Qwen 9B in the fast/default lane. Devstral is the strongest clearly code-specialized slow reviewer, but 8 GB VRAM means partial offload and modest context. |
| **DeepSeek: Coder V2 Lite Instruct** | 16B total/2.4B active, 128K, 338 programming languages, commercial use allowed under the DeepSeek model license; the code repository is MIT, which is not the model's license ([official model card](https://huggingface.co/deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct)). | Still viable for FIM and code-only comparison, but it is a 2024 model with custom-code loading and no first-party claim of modern structured tool calling. It should not displace current Qwen/Granite without a local win. |
| **GLM: GLM-4.7-Flash** | MIT; 30B total/3B active. Z.ai reports 59.2 SWE-bench Verified and 79.5 tau2-Bench and recommends preserved thinking for multi-turn agent tasks ([official model card](https://huggingface.co/zai-org/GLM-4.7-Flash)). | Excellent slow-lane candidate: stronger agent/recovery evidence than most small models, but about 18+ GB at Q4 means RAM-assisted inference. Test 16K first. |
| **MiniMax: MiniMax-M3** | Native multimodal, 1M context, about 428B total/23B active. It uses the MiniMax Community License, whose commercial terms include attribution/notice and authorization above a revenue threshold ([model card](https://huggingface.co/MiniMaxAI/MiniMax-M3), [license](https://huggingface.co/MiniMaxAI/MiniMax-M3/blob/main/LICENSE)). | **Not local on this host.** Active count does not solve the 428B weight footprint. Consider only as a remote escalation service after license review, not as a local route. |
| **Phi: Phi-4-mini-instruct** | 3.8B dense, 128K, MIT, multilingual, code-oriented, and trained for a tool-enabled function-calling format. Microsoft warns that it can hallucinate function names/URLs ([official model card](https://huggingface.co/microsoft/Phi-4-mini-instruct)). | Strong low-memory control for routing, schema repair, and review. Its explicit tool-call limitation makes runtime validation mandatory, as it should be for every model. |
| **Granite: Granite 4.1 8B** | Apache-2.0; long-context instruct model with enhanced tool calling, code tasks, and FIM completion. IBM documents OpenAI-style function definitions and notes SFT/RL post-training ([official model card](https://huggingface.co/ibm-granite/granite-4.1-8b)). | Best independent default/reviewer alternative to Qwen: straightforward license, explicit tool/FIM support, and a different training family. Also benchmark the 3B variant for compression. |
| **Other material candidate: gpt-oss-20b** | Apache-2.0; 21B total/3.6B active; configurable reasoning; native function calling, Python/web tools, and Structured Outputs. OpenAI says the MXFP4 checkpoint runs within 16 GB memory and requires the Harmony format ([official model card](https://huggingface.co/openai/gpt-oss-20b)). | Good structured-output/review lane in 64 GB RAM, but not a full 8 GB GPU fit. Use a runtime that preserves Harmony exactly. Compare with GLM and Devstral rather than assuming benchmark rank. |
| **Other material candidate: Nemotron 3 Nano 4B** | NVIDIA's 4B model supports reasoning on/off, tool-call parsing, and up to 262K configuration; the card reports BFCL-v3 61.1 and RULER-128K 91.1. It uses the NVIDIA Nemotron Open Model License ([official model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16)). | Very attractive fast-lane challenger, especially for tool routing and compression. Confirm GGUF support for its hybrid Mamba/attention architecture and review the custom license before portfolio distribution. |

## License, weights, and behavior are separate questions

Use exact labels:

- **Permissive standard licenses:** Qwen, Gemma 4, Mistral/Devstral, Granite, and gpt-oss checkpoints above are Apache-2.0; Phi and GLM-4.7-Flash are MIT.
- **Custom model licenses:** Llama 3.1, DeepSeek Coder V2, FunctionGemma/Gemma 3, MiniMax-M3, and Nemotron use their named model/community licenses. "Commercial use allowed" is not the same as Apache/MIT.
- **Open-weight vs open-source:** availability of weights does not establish an OSI-approved software license, nor does it disclose all training data or the training pipeline. Record checkpoint, license revision, and chat template in benchmark results.
- **Alignment/censorship:** safety tuning, refusal behavior, prompt sensitivity, and tool-call conservatism are behavioral properties. Do not infer them from weight availability or license. Avoid labels such as "uncensored" unless a first-party card defines and tests the term. Measure refusal, over-refusal, unsafe compliance, and unsupported-operation rejection with project-specific prompts.

## Windows runtime policy

1. **Keep Ollama as the stable service** at the existing loopback endpoint. It runs natively on Windows, supports RTX 3070-class CUDA GPUs, and exposes placement through `ollama ps` ([Windows guide](https://docs.ollama.com/windows), [GPU support](https://docs.ollama.com/gpu)).
2. **Use llama.cpp for controlled experiments:** exact GGUF/quant, explicit GPU-layer offload, KV-cache choices, and an OpenAI-compatible server. Its CPU+GPU hybrid path is the right mechanism for 20B-35B review models ([llama.cpp repository](https://github.com/ggml-org/llama.cpp)).
3. **Use LM Studio for interactive qualification** and schema-constrained API checks. It supports explicit `--gpu` and `--context-length` loading plus JSON-schema structured output ([CLI](https://lmstudio.ai/docs/cli), [structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)). Bind to `127.0.0.1`; the official docs warn that non-loopback binding and CORS expand exposure ([server options](https://lmstudio.ai/docs/cli/serve/server-start)).
4. **Do not make vLLM the Windows default.** Official guidance routes Windows users through WSL with a compatible Linux distribution ([vLLM GPU installation](https://docs.vllm.ai/en/v0.17.0/getting_started/installation/gpu/)). It is worthwhile only for a supported model whose throughput/tool parser cannot be reproduced in Ollama/llama.cpp/LM Studio.
5. Route all local servers through LiteLLM aliases, pin model and template versions, and retain the existing GPU ownership lock. Do not run two large resident models concurrently on 8 GB.

## Routing policy

| Trigger | Route | Limits and acceptance |
| --- | --- | --- |
| Classify task, choose tools/files, compact logs, repair JSON | Fast 4B lane | Temperature 0-0.2; output schema required; no file writes from unvalidated output |
| Bounded implementation, test repair, docs, single review pass | Qwen3.5 9B default | 8K-16K retrieved context; max two repair cycles; tests and diff are authority |
| Browser analysis-plan generation | Fine-tuned FunctionGemma 270M or winning sub-1B candidate | Model emits the plan only; Zod rejects unknown operations; DuckDB computes |
| Cross-file design, stubborn failure, independent review, memory compression checkpoint | Slow local reviewer | Devstral/GLM/gpt-oss winner; 16K-32K; read-only review first; compare claims to diff/tests |
| Security/auth/deployment, destructive or public action, two local models fail, reviewer disagreement, or confidence below threshold | Frontier escalation + human gate | Send a minimal evidence packet; never send secrets; execution remains approval-gated |

Compression should be **structured and reversible**: preserve objective, constraints, decisions with rationale, changed paths, failing/passing commands, unresolved risks, and source links; attach hashes or paths to full logs instead of asking a model to paraphrase everything. Have a different-family reviewer check decision retention before replacing durable context.

## Small benchmark suite

Build a fixed, versioned suite that runs in roughly 20-40 minutes per model/quant:

1. **Structured plans (40 cases):** valid filters/grouping/aggregation/chart requests, unsupported SQL, prompt injection inside column names, missing fields, and ambiguous requests. Score parse rate, schema-valid rate, exact operation/argument accuracy, unsupported-operation rejection, and false refusal.
2. **Tool routing (24 cases):** no-tool, one-tool, parallel tools, wrong-tool distractors, malformed tool result, and a required retry. Score exact function and arguments, invented-tool rate, unnecessary-call rate, and successful recovery.
3. **Coding (6 fixtures):** two focused TypeScript fixes, one cross-file React change, one worker-message bug, one PowerShell edge case, and one documentation-only task. Run typecheck, lint, tests, and build. Score first-pass success, cycles, changed-line precision, unrelated-file touches, and wall time.
4. **Review (6 seeded diffs):** logic bug, unsafe path handling, stale async response, schema bypass, broken Pages base path, and weakened CI. Score issue recall, false positives, severity ordering, and file/line grounding.
5. **Compression (4 transcripts):** 8K and 16K project histories with distractors. Score exact retention of constraints, decisions, paths, commands, blockers, and next action; fail any summary that invents completion.
6. **Long-context retrieval (needle sets at 4K/8K/16K/32K):** require exact cited facts and refusal when absent. This measures the context actually served, not the model-card maximum.

Record model/checkpoint, license, runtime/version, quant, chat template, context, GPU layers, cold-load seconds, prompt/decode tokens per second, peak VRAM/RAM, total wall time, and every raw output. Gate promotion on **zero unrelated-file edits, 100% syntactic structured-output validity, at least 95% supported-operation accuracy, at least 95% unsupported-operation rejection, and a higher coding pass rate than the current `qwen3:8b` baseline**. Use quality first, then latency; vendor leaderboards do not substitute for this repository-specific gate.

## Decision

Download and benchmark only four initial candidates: **Qwen3.5 4B Q4_K_M**, **Qwen3.5 9B Q4_K_M**, **Granite 4.1 8B Q4_K_M**, and **one slow challenger (GLM-4.7-Flash Q4 or Devstral Small 2 Q4)**. Add FunctionGemma to the browser-training workstream separately. This gives meaningful family diversity and covers every routing tier without filling disk and benchmark time with models that cannot plausibly win on this hardware.
