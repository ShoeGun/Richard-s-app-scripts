import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDataCatalog } from '../lib/data-catalog';
import { DataCatalog } from './DataCatalog';

describe('DataCatalog', () => {
  it('shows attribution, safe external links, and loads the bundled entry', () => {
    const onLoadBundled = vi.fn();
    render(
      <DataCatalog
        entries={createDataCatalog('/ShoeGun.github.io/', 'https://shoegun.github.io')}
        onLoadBundled={onLoadBundled}
        loading={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /load bundled data/i }));
    expect(onLoadBundled).toHaveBeenCalledOnce();

    const externalLinks = screen.getAllByRole('link', { name: /open dataset/i });
    expect(externalLinks).toHaveLength(2);
    for (const link of externalLinks) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
    expect(screen.getAllByText(/published by vega datasets/i)).toHaveLength(2);
  });
});
