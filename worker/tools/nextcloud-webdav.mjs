#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WINDOWS_HOME = process.env.USERPROFILE || os.homedir();
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(WINDOWS_HOME, "AppData", "Local");
const RCLONE_NAME = process.platform === "win32" ? "rclone.exe" : "rclone";
const RCLONE = process.env.RCLONE_PATH || [
  path.join(process.cwd(), "tools", "rclone", RCLONE_NAME),
  path.resolve(process.cwd(), "..", "tools", "rclone", RCLONE_NAME)
].find((candidate) => fs.existsSync(candidate)) || path.join(process.cwd(), "tools", "rclone", RCLONE_NAME);
const CONFIG = process.env.NEXTCLOUD_RCLONE_CONFIG || path.join(LOCAL_APP_DATA, "AgenticOS", "nextcloud-rclone.conf");

export const SOURCE_SCOPES = Object.freeze({
  "comfy-models": {
    local: path.join(WINDOWS_HOME, "Documents", "comfy", "ComfyUI", "models"),
    remote: "ComfyUI-Archive/models"
  },
  videos: { local: path.join(WINDOWS_HOME, "Videos"), remote: "Videos" },
  images: {
    local: path.join(WINDOWS_HOME, "OneDrive"),
    remote: "Images",
    filters: ["--filter", "+ **/*.jpg", "--filter", "+ **/*.jpeg", "--filter", "+ **/*.png", "--filter", "+ **/*.webp", "--filter", "+ **/*.gif", "--filter", "+ **/*.bmp", "--filter", "+ **/*.tif", "--filter", "+ **/*.tiff", "--filter", "+ **/*.heic", "--filter", "+ **/*.avif", "--filter", "- *"]
  },
  "apple-backup": { local: path.join(WINDOWS_HOME, "Apple"), remote: "Phone-Backup" },
  "gguf-models": { local: path.join("C:", "AI", "Models", "gguf"), remote: "Models/GGUF-Archive" },
  models: { local: path.join(WINDOWS_HOME, ".cache", "huggingface", "hub"), remote: "Models/HuggingFace-Archive" }
});

function usage() {
  return [
    "Usage: node worker/tools/nextcloud-webdav.mjs <health|list|copy|check>",
    "  --source comfy-models|videos|images|apple-backup|gguf-models|models",
    "  --dry-run (copy only)",
    "  --remote PATH (override the source scope destination)"
  ].join("\n");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dryRun: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--source") options.source = rest[++index];
    else if (token === "--remote") options.remote = rest[++index];
    else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function assertSafeRemote(remote) {
  if (!remote || remote.startsWith("/") || remote.includes("\\") || remote.split("/").includes("..")) {
    throw new Error("Remote path must be relative and cannot contain traversal segments.");
  }
}

function assertReady() {
  if (!fs.existsSync(RCLONE)) throw new Error(`rclone was not found at ${RCLONE}`);
  if (!fs.existsSync(CONFIG)) throw new Error(`Nextcloud rclone config was not found at ${CONFIG}`);
}

function runRclone(args) {
  const result = spawnSync(RCLONE, ["--config", CONFIG, ...args], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function buildCommand(options) {
  const scope = options.source ? SOURCE_SCOPES[options.source] : null;
  if (options.command !== "health" && !scope) throw new Error(`A valid --source is required.\n${usage()}`);
  const remote = options.remote || scope?.remote;
  if (remote) assertSafeRemote(remote);
  if (options.command === "health") return ["lsd", "nextcloud:"];
  if (options.command === "list") return ["lsjson", `nextcloud:${remote}`, "--recursive", "--no-modtime"];
  if (options.command === "copy") {
    const args = ["copy", scope.local, `nextcloud:${remote}`, "--checksum", "--transfers", "2", "--checkers", "4", "--retries", "10", "--low-level-retries", "20", "--stats", "30s", "--stats-one-line", ...(scope.filters || [])];
    if (options.dryRun) args.push("--dry-run");
    return args;
  }
  if (options.command === "check") return ["check", scope.local, `nextcloud:${remote}`, "--one-way", "--size-only", ...(scope.filters || [])];
  throw new Error(`Unknown command: ${options.command}\n${usage()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    assertReady();
    runRclone(buildCommand(options));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
