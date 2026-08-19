import type { AnalysisResult } from './deterministic-analysis';

export type DomFaceData = {
  eyes: [number, number];
  mouth: [number, number, number];
  label: string;
};

const clamp = (value: number) => Math.max(2, Math.min(18, value));

function scale(value: number, min: number, max: number) {
  if (max === min) return 10;
  return clamp(3 + ((value - min) / (max - min)) * 14);
}

export function faceDataFromAnalysis(result: AnalysisResult): DomFaceData {
  const values = result.rows
    .flatMap((row) => Object.values(row))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const source = values.length > 0 ? values : [0];
  const min = Math.min(...source);
  const max = Math.max(...source);
  const middle = source[Math.floor((source.length - 1) / 2)] ?? source[0];
  const last = source[source.length - 1] ?? source[0];

  return {
    eyes: [scale(source[0], min, max), scale(source[1] ?? source[0], min, max)],
    mouth: [scale(source[0], min, max), scale(middle, min, max), scale(last, min, max)],
    label: `${result.rows.length} result row${result.rows.length === 1 ? '' : 's'} · ${result.chart.type} chart`
  };
}
