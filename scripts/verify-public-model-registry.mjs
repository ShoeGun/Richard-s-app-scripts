import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = path.join(root, 'src', 'config', 'public-model-registry.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const targets = [registry.desktop, registry.mobile, registry.handoffLab];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyFile(target, file) {
  const encodedPath = file.split('/').map(encodeURIComponent).join('/');
  const url = `https://huggingface.co/${target.id}/resolve/${target.revision}/${encodedPath}`;
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  });
  requireValue(response.ok, `${target.id}@${target.revision.slice(0, 8)} is missing ${file}: HTTP ${response.status}`);
  const cors = response.headers.get('access-control-allow-origin');
  requireValue(cors === '*' || cors === 'https://huggingface.co', `${target.id}/${file} is not publicly CORS-readable`);
  return { file, status: response.status, cors };
}

for (const target of targets) {
  requireValue(target.id && target.hubUrl === `https://huggingface.co/${target.id}`, `invalid Hub identity for ${target.id || 'unknown target'}`);
  requireValue(/^[0-9a-f]{40}$/.test(target.revision), `${target.id} is not pinned to an immutable revision`);
  requireValue(Array.isArray(target.requiredFiles) && target.requiredFiles.length > 0, `${target.id} has no required-file contract`);
  const receipts = [];
  for (const file of target.requiredFiles) receipts.push(await verifyFile(target, file));
  console.log(JSON.stringify({ ok: true, id: target.id, role: target.role, revision: target.revision, files: receipts }));
}
