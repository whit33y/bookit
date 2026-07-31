/// <reference types='vitest' />
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'api',
    watch: false,
    globals: true,
    environment: 'node',
    // prisma/ też, bo dane demo i planowanie terminów seeda mają własne testy
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/api',
      provider: 'v8' as const,
    },
  },
});
