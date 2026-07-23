import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROTECTED_PREFIXES = [
  ".git/",
  ".worker-control/",
  "node_modules/",
  "worker/",
  "PLANS/",
  "ESCALATIONS/",
  "LOOPS/"
];

const DEFAULT_PROTECTED_FILES = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "BLOCKERS.md",
  "DECISIONS.md",
  "HANDOFF.md",
  "RUN_LOG.md",
  "SPEC.md",
  "TASKS.md",
  "WORKER_STATE.json",
  "loop.config.json"
];

const DEFAULT_ALWAYS_EDITABLE = ["package.json", "package-lock.json"];

function normalizeSlashes(value) {
  return value.replaceAll("\\", "/");
}

export function resolveRepositoryPath(root, inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("Edit path must be a non-empty string.");
  }

  const normalized = normalizeSlashes(inputPath.trim()).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized === "." || normalized.includes("\0")) {
    throw new Error(`Edit path must identify a file: ${inputPath}`);
  }
  if (normalized.split("/").includes("..") || path.isAbsolute(inputPath)) {
    throw new Error(`Unsafe path outside repository: ${inputPath}`);
  }

  const absolute = path.resolve(root, normalized);
  const rootWithSeparator = `${path.resolve(root).toLowerCase()}${path.sep}`;
  if (!absolute.toLowerCase().startsWith(rootWithSeparator)) {
    throw new Error(`Unsafe path outside repository: ${inputPath}`);
  }
  return { normalized, absolute };
}

function pathMatchesScope(filePath, scope) {
  const normalizedScope = normalizeSlashes(String(scope || "")).replace(/^\/+|\/+$/g, "");
  if (!normalizedScope) return false;
  return filePath === normalizedScope || filePath.startsWith(`${normalizedScope}/`);
}

function validateContent(filePath, content) {
  const trimmed = content.trim();
  const placeholderPatterns = [
    /^see attached/i,
    /add your .* here/i,
    /keep existing .* styles/i,
    /keep existing .* components/i,
    /remove this file or replace/i,
    /\.\.\. keep existing/i,
    /\{\s*\/\*\s*add your/i
  ];
  const matched = placeholderPatterns.find((pattern) => pattern.test(trimmed));
  if (matched) throw new Error(`Rejected placeholder edit for ${filePath}: ${matched}`);

  if (filePath.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(`Rejected invalid JSON for ${filePath}: ${error.message}`, { cause: error });
    }
  }
}

export async function validateProposal({ root, task, action, config = {} }) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new Error("Model response must be a JSON object.");
  }
  if (!Array.isArray(action.edits) || action.edits.length === 0) {
    throw new Error("A task proposal must contain at least one file edit.");
  }

  const limits = config.proposalLimits || {};
  const maxFiles = limits.maxFilesPerTask || 12;
  const maxFileChars = limits.maxCharsPerFile || 120000;
  const maxTotalChars = limits.maxTotalEditChars || 400000;
  if (action.edits.length > maxFiles) {
    throw new Error(`Proposal edits ${action.edits.length} files; limit is ${maxFiles}.`);
  }

  const protectedPrefixes = config.protectedPathPrefixes || DEFAULT_PROTECTED_PREFIXES;
  const protectedFiles = new Set(config.protectedFiles || DEFAULT_PROTECTED_FILES);
  const alwaysEditable = config.alwaysEditablePaths || DEFAULT_ALWAYS_EDITABLE;
  const taskScopes = Array.isArray(task.focus) ? task.focus : [];
  const seen = new Set();
  let totalChars = 0;
  const edits = [];

  for (const edit of action.edits) {
    const safe = resolveRepositoryPath(root, edit?.path);
    const lowered = safe.normalized.toLowerCase();
    if (protectedFiles.has(safe.normalized) || protectedPrefixes.some((prefix) => lowered.startsWith(prefix.toLowerCase()))) {
      throw new Error(`Task ${task.id} may not edit orchestration path ${safe.normalized}.`);
    }
    if (!taskScopes.some((scope) => pathMatchesScope(safe.normalized, scope))
      && !alwaysEditable.some((scope) => pathMatchesScope(safe.normalized, scope))) {
      throw new Error(`Edit ${safe.normalized} is outside task ${task.id} focus.`);
    }
    if (seen.has(lowered)) throw new Error(`Duplicate edit path: ${safe.normalized}`);
    seen.add(lowered);

    let content = edit.content;
    if (safe.normalized.toLowerCase().endsWith(".json")
      && content !== null
      && typeof content === "object"
      && !Array.isArray(content)) {
      content = `${JSON.stringify(content, null, 2)}\n`;
    }
    if (typeof content !== "string") {
      throw new Error(`Edit for ${safe.normalized} is missing string content.`);
    }
    if (content.length > maxFileChars) {
      throw new Error(`Edit for ${safe.normalized} exceeds ${maxFileChars} characters.`);
    }
    totalChars += content.length;
    if (totalChars > maxTotalChars) {
      throw new Error(`Proposal content exceeds ${maxTotalChars} characters.`);
    }
    validateContent(safe.normalized, content);

    if (existsSync(safe.absolute)) {
      const stat = await fs.stat(safe.absolute);
      if (!stat.isFile()) throw new Error(`Edit path is an existing directory: ${safe.normalized}`);
    }
    edits.push({ path: safe.normalized, absolute: safe.absolute, content });
  }

  return {
    summary: String(action.summary || "").slice(0, 1000),
    notes: Array.isArray(action.notes) ? action.notes.map(String).slice(0, 20) : [],
    commands: Array.isArray(action.commands) ? [...new Set(action.commands.map(String))] : [],
    edits
  };
}

export function commitPathsForProposal(proposal) {
  const paths = new Set(proposal.edits.map((edit) => edit.path));
  if (paths.has("package.json")) paths.add("package-lock.json");
  return [...paths];
}
