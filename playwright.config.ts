import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const isLocalhost = BASE_URL.startsWith('http://localhost')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isLocalhost
    ? [
        {
          command: 'uv run uvicorn app.main:app --port 8000',
          port: 8000,
          reuseExistingServer: !process.env.CI,
          timeout: 30000,
        },
        {
          command: 'npm run dev --prefix frontend',
          port: 5173,
          reuseExistingServer: !process.env.CI,
          timeout: 30000,
        },
      ]
    : undefined,
})
