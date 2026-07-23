import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const proofPath = path.join(root, "worker-evidence", "qwen-edit-proof.md");

if (!existsSync(proofPath)) {
  console.error(`Missing proof file: ${proofPath}`);
  process.exit(1);
}

const content = readFileSync(proofPath, "utf8");
if (!content.includes("Qwen local edit proof")) {
  console.error("Proof file does not contain the required phrase.");
  process.exit(1);
}

console.log("Qwen edit proof verified.");

