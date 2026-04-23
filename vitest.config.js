import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/data/**'],
      exclude: ['src/ui/**', 'src/api/**', 'src/styles/**'],
      reporter: ['text', 'html'],
    },
  },
});
