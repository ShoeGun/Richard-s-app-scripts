import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeBase = (value?: string) => {
  const base = !value || value === '/' ? '/agent/' : value;
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export default defineConfig({
  root: 'src/agent',
  plugins: [react()],
  base: normalizeBase(process.env.VITE_BASE_PATH),
  build: {
    outDir: '../../dist/agent',
    emptyOutDir: true
  }
});
