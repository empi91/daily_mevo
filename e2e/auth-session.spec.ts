import { test, expect } from '@playwright/test'

const PASSWORD = 'testpass99'

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}@example.com`
}

test.describe('auth cookie round-trip', () => {
  test('register → auto-login → session persists on reload → logout', async ({ page }) => {
    const email = uniqueEmail('reg')

    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Hasło').fill(PASSWORD)
    await page.getByRole('button', { name: 'Zarejestruj się' }).click()

    await page.waitForURL('/')
    await expect(page.getByText(email)).toBeVisible()

    await page.reload()
    await expect(page.getByText(email)).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
    await expect(page.getByRole('link', { name: 'Zaloguj się' })).toBeVisible()
    await expect(page.getByText(email)).not.toBeVisible()
  })

  test('login with credentials → session → logout', async ({ page }) => {
    const email = uniqueEmail('login')

    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Hasło').fill(PASSWORD)
    await page.getByRole('button', { name: 'Zarejestruj się' }).click()
    await page.waitForURL('/')

    await page.getByRole('button', { name: 'Wyloguj' }).click()
    await expect(page.getByRole('link', { name: 'Zaloguj się' })).toBeVisible()

    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Hasło').fill(PASSWORD)
    await page.getByRole('button', { name: 'Zaloguj się' }).click()

    await page.waitForURL('/')
    await expect(page.getByText(email)).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
    await expect(page.getByRole('link', { name: 'Zaloguj się' })).toBeVisible()
  })

  test('fastapiusersauth cookie has correct attributes after login', async ({ page, context }) => {
    const email = uniqueEmail('cookie')

    await page.goto('/register')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Hasło').fill(PASSWORD)
    await page.getByRole('button', { name: 'Zarejestruj się' }).click()
    await page.waitForURL('/')
    await expect(page.getByText(email)).toBeVisible()

    const cookies = await context.cookies()
    const authCookie = cookies.find((c) => c.name === 'fastapiusersauth')

    expect(authCookie, 'fastapiusersauth cookie must exist after login').toBeDefined()
    expect(authCookie!.httpOnly).toBe(true)
    expect(authCookie!.sameSite).toBe('Lax')
    expect(authCookie!.path).toBe('/')

    const baseUrl = process.env.E2E_BASE_URL ?? ''
    const isProduction = baseUrl.startsWith('https://')
    expect(authCookie!.secure).toBe(isProduction)
  })
})
