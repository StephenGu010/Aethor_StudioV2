import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const frontendRoot = filePath(new URL('.', import.meta.url)).replace(/\/$/, '');
const profilesDirectory = filePath(new URL('../../shared/robot-profiles/BuiltIn', import.meta.url));
const dummyProfileDirectory = `${profilesDirectory}/dummy-6dof`;
const aethorRoboProfileDirectory = `${profilesDirectory}/aethor-robo-dual-7dof`;

function filePath(url: URL) {
  return normalizePath(decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:)/, '')).replace(/\/$/, '');
}

export default defineConfig(({ mode }) => ({
  define: mode === 'e2e'
    ? {
        'import.meta.env.VITE_AETHOR_GATEWAY_URL': JSON.stringify(''),
        'import.meta.env.VITE_AETHOR_GATEWAY_SESSION_TOKEN': JSON.stringify('')
      }
    : undefined,
  plugins: [
    react(),
    viteStaticCopy({
      targets: [dummyProfileDirectory, aethorRoboProfileDirectory].map((profileDirectory) => ({
        src: `${profileDirectory}/**/*`,
        dest: 'robot-profiles',
        rename: { stripBase: 3 }
      }))
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
}));
