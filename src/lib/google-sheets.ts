import type { UploadedDataset } from './upload';

export interface GoogleSheetReference {
  spreadsheetId: string;
  gid: string;
  csvUrl: string;
}

function readHashGid(url: URL) {
  const hash = url.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('gid');
}

export function parseGoogleSheetUrl(input: string): GoogleSheetReference {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Paste a valid Google Sheets sharing link.');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Use a Google Sheets link from docs.google.com.');
  }

  const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('That link does not look like a Google Sheet.');

  const gid = url.searchParams.get('gid') || readHashGid(url) || '0';
  const spreadsheetId = match[1];
  return {
    spreadsheetId,
    gid,
    csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`
  };
}

export async function fetchGoogleSheet(input: string): Promise<UploadedDataset> {
  const reference = parseGoogleSheetUrl(input);
  let response: Response;
  try {
    response = await fetch(reference.csvUrl, { mode: 'cors' });
  } catch {
    throw new Error('The sheet could not be reached. Check that it is shared publicly and try again.');
  }

  if (!response.ok) {
    throw new Error(`Google Sheets returned HTTP ${response.status}. Make the sheet readable to anyone with the link.`);
  }

  const content = await response.text();
  if (!content.trim() || /^\s*<!doctype html/i.test(content)) {
    throw new Error('Google Sheets did not return CSV data. Publish the sheet or allow anyone with the link to view it.');
  }

  return {
    fileName: `google-sheet-${reference.spreadsheetId.slice(0, 12)}.csv`,
    format: 'csv',
    content
  };
}
