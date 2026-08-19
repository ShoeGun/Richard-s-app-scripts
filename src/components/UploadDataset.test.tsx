import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UploadDataset } from './UploadDataset';

describe('UploadDataset', () => {
  afterEach(cleanup);

  it('inspects a selected CSV and renders its schema', async () => {
    const onInspect = vi.fn(async () => [
      { name: 'name', type: 'VARCHAR', nullable: true }
    ]);
    render(<UploadDataset onInspect={onInspect} />);

    fireEvent.change(screen.getByLabelText(/choose csv or json/i), {
      target: { files: [new File(['name\nAda'], 'people.csv')] }
    });

    await waitFor(() => expect(onInspect).toHaveBeenCalledOnce());
    expect(screen.getByRole('table', { name: /schema for people.csv/i })).toBeTruthy();
  });

  it('shows a handled error for unsupported files', async () => {
    render(<UploadDataset onInspect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/choose csv or json/i), {
      target: { files: [new File(['hello'], 'notes.txt')] }
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/supports csv and json/i));
  });
});
