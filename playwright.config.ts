import { defineConfig } from '@playwright/test'

// The desktop table is a live three.js scene. Headless Chromium falls back to
// software GL without these flags, which stalls the main thread for tens of
// seconds per frame and makes every multi-client test time out.
const gpuArgs = process.platform === 'win32'
  ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11']
  : ['--enable-gpu', '--ignore-gpu-blocklist']

export default defineConfig({
  testDir: './e2e',
  // Every spec drives several live clients against one shared PartyKit dev
  // server and GPU; running files in parallel only produces timing flakes.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: './test-results',
  use: {
    launchOptions: { args: gpuArgs },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
  },
})
