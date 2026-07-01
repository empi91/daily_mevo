import { test, expect } from '@playwright/test'

const PASSWORD = 'testpass99'

function uniqueEmail(label: string): string {
  return `e2e-fav-${label}-${Date.now()}@example.com`
}

async function registerAndLogin(page: import('@playwright/test').Page, email: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Hasło').fill(PASSWORD)
  await page.getByRole('button', { name: 'Zarejestruj się' }).click()
  await page.waitForURL('/')
  await expect(page.getByText(email)).toBeVisible()
}

async function navigateToFirstStation(page: import('@playwright/test').Page) {
  await page.goto('/')
  const popularSection = page.getByRole('heading', { name: 'Popularne stacje' })
  await expect(popularSection).toBeVisible()
  const firstStationLink = page.getByRole('link').filter({ hasText: /^[A-Z]{3}\d{3}/ }).first()
  await expect(firstStationLink).toBeVisible()
  const linkText = await firstStationLink.textContent()
  const stationName = linkText!.match(/^[A-Z]{3}\d{3}/)![0]
  await firstStationLink.click()
  await expect(page).toHaveURL(/\/stations\//)
  await expect(page.getByText('Wróć do wyszukiwania')).toBeVisible()
  return stationName
}

test.describe('favourites lifecycle', () => {
  test('favourite toggle appears on station detail for authenticated user', async ({ page }) => {
    const email = uniqueEmail('toggle-visible')
    await registerAndLogin(page, email)

    await navigateToFirstStation(page)

    await expect(page.getByRole('button', { name: 'Dodaj do ulubionych' })).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
  })

  test('favourite toggle hidden for anonymous user', async ({ page }) => {
    await page.goto('/')
    const popularHeading = page.getByRole('heading', { name: 'Popularne stacje' })
    await expect(popularHeading).toBeVisible()
    const firstStationLink = page.getByRole('link').filter({ hasText: /^[A-Z]{3}\d{3}/ }).first()
    await firstStationLink.click()
    await expect(page).toHaveURL(/\/stations\//)

    await expect(page.getByRole('button', { name: 'Dodaj do ulubionych' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Usuń z ulubionych' })).not.toBeVisible()
  })

  test('adding a favourite shows station on homepage', async ({ page }) => {
    const email = uniqueEmail('add-fav')
    await registerAndLogin(page, email)

    const stationName = await navigateToFirstStation(page)

    await page.getByRole('button', { name: 'Dodaj do ulubionych' }).click()
    await expect(page.getByRole('button', { name: 'Usuń z ulubionych' })).toBeVisible()

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Twoje ulubione stacje' })).toBeVisible()
    await expect(page.getByText(stationName)).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
  })

  test('removing favourite from homepage falls back to popular', async ({ page }) => {
    const email = uniqueEmail('remove-fav')
    await registerAndLogin(page, email)

    const stationName = await navigateToFirstStation(page)
    await page.getByRole('button', { name: 'Dodaj do ulubionych' }).click()
    await expect(page.getByRole('button', { name: 'Usuń z ulubionych' })).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Twoje ulubione stacje' })).toBeVisible()

    await page.getByRole('button', { name: `Usuń ${stationName} z ulubionych` }).click()

    await expect(page.getByRole('heading', { name: 'Twoje ulubione stacje' })).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Popularne stacje' })).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
  })

  test('favourite persists across page reload', async ({ page }) => {
    const email = uniqueEmail('persist')
    await registerAndLogin(page, email)

    const stationName = await navigateToFirstStation(page)
    await page.getByRole('button', { name: 'Dodaj do ulubionych' }).click()
    await expect(page.getByRole('button', { name: 'Usuń z ulubionych' })).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Twoje ulubione stacje' })).toBeVisible()
    await expect(page.getByText(stationName)).toBeVisible()

    await page.reload()

    await expect(page.getByRole('heading', { name: 'Twoje ulubione stacje' })).toBeVisible()
    await expect(page.getByText(stationName)).toBeVisible()

    await page.getByRole('button', { name: 'Wyloguj' }).click()
  })
})
