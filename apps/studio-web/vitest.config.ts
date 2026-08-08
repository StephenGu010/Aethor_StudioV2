import react from '@vitejs/plugin-react';
import { normalizePath } from 'vite';
import { defineConfig } from 'vitest/config';

const profilesDirectory = normalizePath(
  decodeURIComponent(new URL('../../shared/robot-profiles/BuiltIn', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '')
).replace(/\/$/, '');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@profiles': profilesDirectory
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { reporter: ['text', 'html'] }
  }
});
