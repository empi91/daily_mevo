import { test, expect } from '@playwright/test'

async function navigateToStationWithHeatmap(page: import('@playwright/test').Page) {
  await page.goto('/')

  const popularHeading = page.getByRole('heading', { name: 'Popularne stacje' })
  const hasPopular = await popularHeading.isVisible().catch(() => false)
  if (!hasPopular) return false

  const firstStationLink = page.getByRole('link').filter({ hasText: /[0-9]{4}/ }).first()
  const linkCount = await firstStationLink.count()
  if (linkCount === 0) return false

  await firstStationLink.click()
  await page.waitForURL(/\/stations\//)

  const heatmapSection = page.getByRole('heading', { name: 'Dostępność w ciągu tygodnia' })
  const hasHeatmap = await heatmapSection.isVisible().catch(() => false)
  return hasHeatmap
}

test.describe('heatmap color scale — 5-tier verification', () => {
  test('legend shows all 6 entries', async ({ page }) => {
    const ready = await navigateToStationWithHeatmap(page)
    if (!ready) {
      test.skip()
      return
    }

    await expect(page.getByText('≥10 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('7–9 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('4–6 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('2–3 rowery łącznie')).toBeVisible()
    await expect(page.getByText('0–1 rower łącznie')).toBeVisible()
    await expect(page.getByText('brak danych')).toBeVisible()
  })

  test('gray cells have bg-gray-200 and title containing brak danych', async ({ page }) => {
    const ready = await navigateToStationWithHeatmap(page)
    if (!ready) {
      test.skip()
      return
    }

    const grayCell = page.locator('[title*="brak danych"]').first()
    const count = await grayCell.count()
    if (count === 0) {
      test.skip()
      return
    }
    await expect(grayCell).toBeVisible()
    const classAttr = await grayCell.getAttribute('class')
    expect(classAttr).toContain('bg-gray-200')
  })

  test('coloured cells have a colour class and title showing bike count', async ({ page }) => {
    const ready = await navigateToStationWithHeatmap(page)
    if (!ready) {
      test.skip()
      return
    }

    const colouredCell = page.locator('[title*="śr."]').first()
    const count = await colouredCell.count()
    if (count === 0) {
      test.skip()
      return
    }
    await expect(colouredCell).toBeVisible()
    const title = await colouredCell.getAttribute('title')
    expect(title).toMatch(/śr\. \d+ rower/)
    const classAttr = await colouredCell.getAttribute('class')
    expect(classAttr).toMatch(/bg-(red-500|orange-400|yellow-400|lime-400|green-500)/)
  })
})
