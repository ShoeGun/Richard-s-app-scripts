import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('preserves the portfolio identity and local AI entry point', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /richard jones/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /launch local ai/i })).toBeTruthy();
  });
});
