import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnalysisResultView } from './AnalysisResultView';
import type { AnalysisResult } from '../lib/deterministic-analysis';

const barResult: AnalysisResult = {
  rows: [
    { category: 'web', projects: 2 },
    { category: 'ai', projects: 5 }
  ],
  chart: { type: 'bar', x: 'category', y: 'projects' }
};

afterEach(cleanup);

describe('AnalysisResultView', () => {
  it('keeps an accessible table alongside a named chart', () => {
    render(<AnalysisResultView result={barResult} />);

    const table = screen.getByRole('table', { name: 'Local AI analysis result' });
    expect(within(table).getByRole('columnheader', { name: 'category' })).toBeTruthy();
    expect(within(table).getByText('ai')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bar chart of projects by category' })).toBeTruthy();
    expect(screen.getByRole('graphics-symbol', { name: 'ai: 5' })).toBeTruthy();
    expect(screen.getByText(/ai has the highest projects at 5/)).toBeTruthy();
  });

  it('renders the table and summary without a chart for table selection', () => {
    render(<AnalysisResultView result={{ ...barResult, chart: { type: 'table' } }} />);

    expect(screen.getByRole('table', { name: 'Local AI analysis result' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('2 rows returned. Table view selected.')).toBeTruthy();
  });
});
