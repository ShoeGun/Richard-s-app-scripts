import React from 'react';

import type { AnalysisResult } from '../lib/deterministic-analysis';
import {
  deriveChartSeries,
  summarizeAnalysisResult,
  type ChartPoint,
  type ChartSeries
} from '../lib/result-presentation';
import './AnalysisResultView.css';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 280;
const PLOT = { left: 52, right: 20, top: 20, bottom: 46 };

const pointLabel = (point: ChartPoint) => `${point.label}: ${point.y}`;

function ResultChart({ series }: { series: ChartSeries }) {
  const titleId = React.useId();
  const plotWidth = VIEW_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = VIEW_HEIGHT - PLOT.top - PLOT.bottom;
  const yRange = series.maxY - series.minY || 1;
  const xValues = series.points.map((point) => point.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const xRange = maxX - minX || 1;
  const xAt = (point: ChartPoint, index: number) => series.type === 'scatter'
    ? PLOT.left + ((point.x - minX) / xRange) * plotWidth
    : PLOT.left + ((index + 0.5) / series.points.length) * plotWidth;
  const yAt = (value: number) =>
    PLOT.top + ((series.maxY - value) / yRange) * plotHeight;
  const baseline = yAt(0);
  const barWidth = Math.max(8, Math.min(64, (plotWidth / series.points.length) * 0.64));
  const polyline = series.points
    .map((point, index) => `${xAt(point, index)},${yAt(point.y)}`)
    .join(' ');
  const accessibleName = `${series.type[0].toUpperCase()}${series.type.slice(1)} chart of `
    + `${series.yField} by ${series.xField}`;

  return (
    <figure className="result-chart">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{accessibleName}</title>
        <line className="chart-axis" x1={PLOT.left} x2={VIEW_WIDTH - PLOT.right} y1={baseline} y2={baseline} />
        <text className="chart-tick" x={PLOT.left - 8} y={PLOT.top + 5} textAnchor="end">{series.maxY}</text>
        <text className="chart-tick" x={PLOT.left - 8} y={VIEW_HEIGHT - PLOT.bottom + 5} textAnchor="end">{series.minY}</text>

        {series.type === 'bar' && series.points.map((point, index) => {
          const valueY = yAt(point.y);
          return (
            <rect
              className="chart-mark chart-bar"
              role="graphics-symbol"
              aria-label={pointLabel(point)}
              tabIndex={0}
              key={`${point.label}-${index}`}
              x={xAt(point, index) - barWidth / 2}
              y={Math.min(valueY, baseline)}
              width={barWidth}
              height={Math.max(1, Math.abs(baseline - valueY))}
            >
              <title>{pointLabel(point)}</title>
            </rect>
          );
        })}

        {series.type === 'line' && (
          <>
            <polyline className="chart-line" points={polyline} />
            {series.points.map((point, index) => (
              <circle
                className="chart-mark chart-point"
                role="graphics-symbol"
                aria-label={pointLabel(point)}
                tabIndex={0}
                key={`${point.label}-${index}`}
                cx={xAt(point, index)}
                cy={yAt(point.y)}
                r={5}
              >
                <title>{pointLabel(point)}</title>
              </circle>
            ))}
          </>
        )}

        {series.type === 'scatter' && series.points.map((point, index) => (
          <circle
            className="chart-mark chart-point"
            role="graphics-symbol"
            aria-label={pointLabel(point)}
            tabIndex={0}
            key={`${point.label}-${index}`}
            cx={xAt(point, index)}
            cy={yAt(point.y)}
            r={6}
          >
            <title>{pointLabel(point)}</title>
          </circle>
        ))}

        {series.points.map((point, index) => (
          <text
            className="chart-label"
            key={`label-${point.label}-${index}`}
            x={xAt(point, index)}
            y={VIEW_HEIGHT - 18}
            textAnchor="middle"
          >
            {point.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}

export function AnalysisResultView({ result }: { result: AnalysisResult }) {
  const fields = Object.keys(result.rows[0] ?? {});
  const series = deriveChartSeries(result);

  return (
    <section className="analysis-result" aria-label="Analysis result">
      <p className="result-summary">{summarizeAnalysisResult(result)}</p>
      {series && <ResultChart series={series} />}
      <div className="result-table-wrap">
        <table aria-label="Local AI analysis result">
          <thead>
            <tr>
              {fields.map((field) => <th scope="col" key={field}>{field}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index}>
                {fields.map((field) => <td key={field}>{String(row[field] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
