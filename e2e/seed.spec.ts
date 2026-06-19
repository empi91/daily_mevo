// seed.spec.ts — exemplar every generated test is modeled on.
// Risk: session data persists after page reload (issue #24 pattern).
// Demonstrates: role-based locators, test independence, wait-for-state, risk-tied name.
import { test, expect } from '@playwright/test'

test('session persists after page reload', async ({ page }) => {
  const email = `seed-${Date.now()}@example.com`
  const password = 'seedpass99'

  // Setup: register a new user (auto-logs in on success)
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Hasło').fill(password)
  await page.getByRole('button', { name: 'Zarejestruj się' }).click()

  // Assert: redirected to home and user email visible in header
  await page.waitForURL('/')
  await expect(page.getByText(email)).toBeVisible()

  // Core risk: session survives a full page reload (not just client-side nav)
  await page.reload()
  await expect(page.getByText(email)).toBeVisible()

  // Cleanup: logout so test leaves no authenticated state
  await page.getByRole('button', { name: 'Wyloguj' }).click()
  await expect(page.getByRole('link', { name: 'Zaloguj się' })).toBeVisible()
})
