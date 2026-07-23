import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeBase = (value?: string) => {
  if (!value) return '/';
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
};

export default defineConfig({
  plugins: [react()],
  base: normalizeBase(process.env.VITE_BASE_PATH || "/"),
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});