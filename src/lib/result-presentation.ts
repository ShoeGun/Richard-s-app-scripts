import type { AnalysisResult } from './deterministic-analysis';

export interface ChartPoint {
  label: string;
  x: number;
  y: number;
}

export interface ChartSeries {
  type: 'bar' | 'line' | 'scatter';
  xField: string;
  yField: string;
  points: ChartPoint[];
  minY: number;
  maxY: number;
}

const displayValue = (value: number) => String(Number.isInteger(value) ? value : Number(value.toFixed(4)));

export function deriveChartSeries(result: AnalysisResult): ChartSeries | null {
  const { chart, rows } = result;
  if (chart.type === 'table' || !chart.x || !chart.y || rows.length === 0) return null;

  const points = rows.flatMap((row, index): ChartPoint[] => {
    const value = row[chart.y as string];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    const rawX = row[chart.x as string];
    return [{
      label: String(rawX ?? ''),
      x: chart.type === 'scatter' && typeof rawX === 'number' ? rawX : index,
      y: value
    }];
  });
  if (points.length === 0) return null;

  return {
    type: chart.type,
    xField: chart.x,
    yField: chart.y,
    points,
    minY: Math.min(0, ...points.map((point) => point.y)),
    maxY: Math.max(0, ...points.map((point) => point.y))
  };
}

export function summarizeAnalysisResult(result: AnalysisResult): string {
  const count = result.rows.length;
  if (count === 0) return 'No result rows returned.';

  const countText = `${count} ${count === 1 ? 'row' : 'rows'} returned.`;
  const series = deriveChartSeries(result);
  if (result.chart.type === 'table') return `${countText} Table view selected.`;
  if (!series) return `${countText} No plottable numeric values were returned.`;

  const highest = series.points.reduce((best, point) => point.y > best.y ? point : best);
  const chartName = `${series.type[0].toUpperCase()}${series.type.slice(1)}`;
  return `${countText} ${chartName} chart plots ${series.yField} by ${series.xField}. `
    + `${highest.label} has the highest ${series.yField} at ${displayValue(highest.y)}.`;
}
