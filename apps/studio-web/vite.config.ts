import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const frontendRoot = filePath(new URL('.', import.meta.url)).replace(/\/$/, '');
const profilesDirectory = filePath(new URL('../../shared/robot-profiles/BuiltIn', import.meta.url));
const dummyProfileDirectory = `${profilesDirectory}/dummy-6dof`;

function filePath(url: URL) {
  return normalizePath(decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:)/, '')).replace(/\/$/, '');
}

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [{
        src: `${dummyProfileDirectory}/**/*`,
        dest: 'robot-profiles',
        rename: { stripBase: 3 }
      }]
    })
  ],
  resolve: {
    alias: {
      '@profiles': profilesDirectory
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [frontendRoot, profilesDirectory]
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  build: {
    chunkSizeWarningLimit: 1000
  }
});
