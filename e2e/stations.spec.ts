import { test, expect } from '@playwright/test'

test.describe('public station pages', () => {
  test('home page loads with search box', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'MevoStats', level: 1 })).toBeVisible()
    await expect(
      page.getByPlaceholder('Wpisz numer stacji, nazwę lub adres...'),
    ).toBeVisible()
  })

  test('station detail page loads from popular stations list', async ({ page }) => {
    await page.goto('/')

    const popularHeading = page.getByRole('heading', { name: 'Popularne stacje' })
    const hasPopular = await popularHeading.isVisible().catch(() => false)

    if (!hasPopular) {
      test.skip()
      return
    }

    const firstStationLink = page.getByRole('link').filter({ hasText: /[0-9]{4}/ }).first()
    await firstStationLink.click()

    await expect(page).toHaveURL(/\/stations\//)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
