import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_SCOPES, buildCommand } from "../tools/nextcloud-webdav.mjs";

test("named source scopes point at archive destinations", () => {
  assert.equal(SOURCE_SCOPES["comfy-models"].remote, "ComfyUI-Archive/models");
  assert.equal(SOURCE_SCOPES.videos.remote, "Videos");
  assert.equal(SOURCE_SCOPES.images.remote, "Images");
  assert.equal(SOURCE_SCOPES["apple-backup"].remote, "Phone-Backup");
  assert.equal(SOURCE_SCOPES["gguf-models"].remote, "Models/GGUF-Archive");
});

test("health does not require a local source", () => {
  assert.deepEqual(buildCommand({ command: "health" }), ["lsd", "nextcloud:"]);
});

test("copy is resumable-oriented and dry-run capable", () => {
  const args = buildCommand({ command: "copy", source: "comfy-models", dryRun: true });
  assert.equal(args[0], "copy");
  assert.ok(args.includes("--checksum"));
  assert.ok(args.includes("--dry-run"));
});

test("image archive scope filters to image extensions", () => {
  const args = buildCommand({ command: "copy", source: "images", dryRun: true });
  assert.ok(args.includes("+ **/*.jpg"));
  assert.ok(args.includes("--filter"));
});

test("remote traversal is rejected", () => {
  assert.throws(() => buildCommand({ command: "list", source: "videos", remote: "../private" }), /traversal/);
});
