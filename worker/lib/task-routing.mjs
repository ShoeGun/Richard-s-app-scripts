const COMPLEX_KEYWORDS = [
  "architecture",
  "browser",
  "duckdb",
  "evaluation",
  "integration",
  "model",
  "parquet",
  "security",
  "training",
  "wasm",
  "webgpu",
  "worker"
];

export function profileTaskDifficulty(task = {}) {
  const text = [
    task.title,
    task.objective,
    ...(task.acceptance || []),
    ...(task.focus || [])
  ].filter(Boolean).join(" ").toLowerCase();
  const reasons = [];
  let score = 0;

  const dependencyCount = (task.dependsOn || []).length;
  if (dependencyCount >= 2) {
    score += 2;
    reasons.push(`${dependencyCount} dependencies`);
  } else if (dependencyCount === 1) {
    score += 1;
  }

  const focusCount = (task.focus || []).length;
  if (focusCount >= 4) {
    score += 2;
    reasons.push(`${focusCount} focus areas`);
  } else if (focusCount >= 2) {
    score += 1;
  }

  const acceptanceCount = (task.acceptance || []).length;
  if (acceptanceCount >= 4) {
    score += 2;
    reasons.push(`${acceptanceCount} acceptance checks`);
  } else if (acceptanceCount >= 2) {
    score += 1;
  }

  const keywordHits = COMPLEX_KEYWORDS.filter((keyword) => text.includes(keyword));
  if (keywordHits.length >= 3) {
    score += 2;
    reasons.push(`integration signals: ${keywordHits.slice(0, 4).join(", ")}`);
  } else if (keywordHits.length) {
    score += 1;
  }

  const level = score >= 6 ? "complex" : score >= 3 ? "standard" : "simple";
  return { level, score, reasons };
}

export function classifyFailure(error) {
  const text = String(error?.stack || error?.message || error || "").toLowerCase();
  if (/transport|operation was aborted|timed out|econn|socket|fetch failed/.test(text)) return "runtime";
  if (/json|proposal|actionable file edit|requires full content|replacement .* expected exactly once/.test(text)) return "proposal_protocol";
  if (/workspace baseline|edit targets already have uncommitted changes/.test(text)) return "workspace";
  if (/validation failed|typecheck|eslint|test failed|build failed/.test(text)) return "validation";
  if (/diff review failed|acceptance criterion/.test(text)) return "review";
  return "reasoning";
}

export function initialEscalationIndex(ladder, { failureClass, difficulty } = {}) {
  const find = (...ids) => {
    for (const id of ids) {
      const index = ladder.findIndex((channel) => channel.id === id);
      if (index >= 0) return index;
    }
    return 0;
  };

  if (failureClass === "proposal_protocol") {
    return find("groq-gpt-oss-120b", "github-models-codestral", "antigravity-gemini-3.6-flash");
  }
  if (failureClass === "validation" || failureClass === "review" || failureClass === "workspace") {
    return find("hermes-ollama-local", "groq-gpt-oss-120b", "antigravity-gemini-3.6-flash");
  }
  if (difficulty === "complex") {
    return find("groq-gpt-oss-120b", "github-models-deepseek-v3", "antigravity-gemini-3.6-flash");
  }
  return 0;
}

export function trajectoryPolicy(config = {}, taskState = {}) {
  const policy = config.routing?.trajectory || {};
  return {
    maxLocalAttempts: policy.maxLocalAttempts ?? 2,
    maxPostGuidanceAttempts: policy.maxPostGuidanceAttempts ?? 1,
    maxRuntimeRetries: policy.maxRuntimeRetries ?? 2,
    attempts: taskState.trajectoryAttempts || 0,
    runtimeRetries: taskState.runtimeRetries || 0
  };
}
