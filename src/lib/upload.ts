export type UploadFormat = 'csv' | 'json';

export interface UploadedDataset {
  fileName: string;
  format: UploadFormat;
  content: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function extension(fileName: string) {
  return fileName.toLowerCase().split('.').pop() || '';
}

function normalizeJson(content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('The selected JSON file is not valid JSON.');
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (
    rows.length === 0
    || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
  ) {
    throw new Error('JSON data must contain an object or an array of objects.');
  }
  return JSON.stringify(rows);
}

function readFileText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error || new Error('The selected file could not be read.')));
    reader.readAsText(file);
  });
}

export async function readUploadedDataset(file: File): Promise<UploadedDataset> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Choose a CSV or JSON file no larger than 10 MB.');
  }
  const format = extension(file.name);
  if (format !== 'csv' && format !== 'json') {
    throw new Error('This browser demo currently supports CSV and JSON files.');
  }

  const raw = await readFileText(file);
  if (!raw.trim()) throw new Error('The selected file is empty.');
  return {
    fileName: file.name,
    format,
    content: format === 'json' ? normalizeJson(raw) : raw
  };
}
