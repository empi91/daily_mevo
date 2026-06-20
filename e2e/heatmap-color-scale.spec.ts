import { test, expect } from '@playwright/test'

test.describe('heatmap color scale — 5-tier verification', () => {
  test('legend shows all 6 entries', async ({ page }) => {
    await page.goto('/stations/3829')
    await expect(page.getByText('≥10 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('7–9 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('4–6 rowerów łącznie')).toBeVisible()
    await expect(page.getByText('2–3 rowery łącznie')).toBeVisible()
    await expect(page.getByText('0–1 rower łącznie')).toBeVisible()
    await expect(page.getByText('brak danych')).toBeVisible()
  })

  test('heatmap cells render with color classes', async ({ page }) => {
    await page.goto('/stations/3829')
    const heatmapCell = page.locator('[class*="h-6 flex-1 rounded-sm"]').first()
    await expect(heatmapCell).toBeVisible()
    const classAttr = await heatmapCell.getAttribute('class')
    expect(classAttr).toMatch(/bg-(gray-200|red-500|orange-400|yellow-400|lime-400|green-500)/)
  })

  test('gray cells tooltip says brak danych', async ({ page }) => {
    await page.goto('/stations/3829')
    // Target heatmap cells (h-6) with gray colour, not legend swatches (w-3 h-3)
    const grayCell = page.locator('div[class*="h-6"][class*="bg-gray-200"]').first()
    const count = await grayCell.count()
    if (count > 0) {
      const title = await grayCell.getAttribute('title')
      expect(title).toMatch(/brak danych/)
    }
  })

  test('coloured cells tooltip shows bike count', async ({ page }) => {
    await page.goto('/stations/3829')
    const colouredCell = page
      .locator('[class*="h-6 flex-1 rounded-sm"]')
      .filter({ hasNot: page.locator('[class*="bg-gray-200"]') })
      .first()
    const count = await colouredCell.count()
    if (count > 0) {
      const title = await colouredCell.getAttribute('title')
      expect(title).toMatch(/śr\. \d+ rower/)
    }
  })
})
