import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Workspace paketlari testlarda manba koddan (src) olinadi — build talab qilinmaydi
const alias = {
  '@mafia/game-engine': r('./packages/game-engine/src/index.ts'),
  '@mafia/localization': r('./packages/localization/src/index.ts'),
  '@mafia/config': r('./packages/config/src/index.ts'),
  '@mafia/database': r('./packages/database/src/index.ts'),
  '@mafia/bot-core': r('./packages/bot-core/src/index.ts'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
          environment: 'node',
          // CI serverlari sekinroq bo'lishi mumkin
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['apps/**/src/**/*.int.test.ts', 'packages/**/src/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
