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

function countOccurrences(content, search) {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - search.length) {
    const index = content.indexOf(search, offset);
    if (index === -1) break;
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function normalizeReplacementLineEndings(value, content) {
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  return value.replace(/\r\n|\r|\n/g, lineEnding);
}

async function resolveEditContent(safe, edit, limits) {
  const hasContent = Object.prototype.hasOwnProperty.call(edit, "content");
  const hasReplacements = Array.isArray(edit.replacements) && edit.replacements.length > 0;

  if (hasReplacements) {
    if (!existsSync(safe.absolute)) {
      throw new Error(`Edit for ${safe.normalized} requires full content because the file does not exist.`);
    }
    if (!Array.isArray(edit.replacements) || edit.replacements.length === 0) {
      throw new Error(`Edit for ${safe.normalized} must contain at least one replacement.`);
    }
    const maxReplacements = limits.maxReplacementsPerFile || 24;
    if (edit.replacements.length > maxReplacements) {
      throw new Error(`Edit for ${safe.normalized} exceeds ${maxReplacements} replacements.`);
    }

    let content = await fs.readFile(safe.absolute, "utf8");
    for (const [index, replacement] of edit.replacements.entries()) {
      if (typeof replacement?.find !== "string" || !replacement.find) {
        throw new Error(`Replacement ${index + 1} for ${safe.normalized} needs non-empty find text.`);
      }
      if (typeof replacement.replace !== "string") {
        throw new Error(`Replacement ${index + 1} for ${safe.normalized} needs string replace text.`);
      }
      const find = normalizeReplacementLineEndings(replacement.find, content);
      const replace = normalizeReplacementLineEndings(replacement.replace, content);
      const matches = countOccurrences(content, find);
      if (matches !== 1) {
        throw new Error(
          `Replacement ${index + 1} for ${safe.normalized} expected exactly once but found ${matches}.`
        );
      }
      content = content.replace(find, replace);
    }
    return { content, mode: "replace" };
  }

  if (!hasContent) {
    throw new Error(`Edit for ${safe.normalized} must provide content or non-empty replacements.`);
  }
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
  return { content, mode: "full" };
}

function coalesceCompactEdits(edits) {
  const result = [];
  const replacementsByPath = new Map();
  for (const edit of edits) {
    const hasReplacements = Array.isArray(edit?.replacements) && edit.replacements.length > 0;
    const key = typeof edit?.path === "string"
      ? normalizeSlashes(edit.path.trim()).toLowerCase()
      : null;
    const existing = hasReplacements && key ? replacementsByPath.get(key) : null;
    if (existing) {
      existing.replacements.push(...edit.replacements);
      continue;
    }
    const copy = hasReplacements
      ? { ...edit, replacements: [...edit.replacements] }
      : edit;
    result.push(copy);
    if (hasReplacements && key) replacementsByPath.set(key, copy);
  }
  return result;
}

function isActionableEdit(edit) {
  return Object.prototype.hasOwnProperty.call(edit || {}, "content")
    || (Array.isArray(edit?.replacements) && edit.replacements.length > 0);
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
  if (action.edits.length > maxFiles * 4) {
    throw new Error(`Proposal contains too many edit entries; limit is ${maxFiles * 4}.`);
  }
  const proposalEdits = coalesceCompactEdits(action.edits).filter(isActionableEdit);
  if (proposalEdits.length === 0) {
    throw new Error("A task proposal must contain at least one actionable file edit.");
  }
  if (proposalEdits.length > maxFiles) {
    throw new Error(`Proposal edits ${proposalEdits.length} files; limit is ${maxFiles}.`);
  }

  const protectedPrefixes = config.protectedPathPrefixes || DEFAULT_PROTECTED_PREFIXES;
  const protectedFiles = new Set(config.protectedFiles || DEFAULT_PROTECTED_FILES);
  const alwaysEditable = config.alwaysEditablePaths || DEFAULT_ALWAYS_EDITABLE;
  const taskScopes = Array.isArray(task.focus) ? task.focus : [];
  const seen = new Set();
  let totalChars = 0;
  const edits = [];

  for (const edit of proposalEdits) {
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

    const resolved = await resolveEditContent(safe, edit, limits);
    const { content } = resolved;
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
    edits.push({ path: safe.normalized, absolute: safe.absolute, content, mode: resolved.mode });
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
