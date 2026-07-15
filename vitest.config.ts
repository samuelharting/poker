import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  oxc: false,
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.next/**',
      '**/.claude/worktrees/**',
    ],
  },
})
