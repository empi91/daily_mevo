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

  test('gray cells have bg-gray-200 and title containing brak danych', async ({ page }) => {
    await page.goto('/stations/3829')
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
    await page.goto('/stations/3829')
    const colouredCell = page.locator('[title*="śr."]').first()
    await expect(colouredCell).toBeVisible()
    const title = await colouredCell.getAttribute('title')
    expect(title).toMatch(/śr\. \d+ rower/)
    const classAttr = await colouredCell.getAttribute('class')
    expect(classAttr).toMatch(/bg-(red-500|orange-400|yellow-400|lime-400|green-500)/)
  })
})
