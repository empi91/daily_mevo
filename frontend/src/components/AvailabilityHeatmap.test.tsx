import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AvailabilityHeatmap from './AvailabilityHeatmap'
import { TEST_AVAILABILITY } from '../test/fixtures'

const defaultProps = {
  availability: TEST_AVAILABILITY,
  selectedDay: 0,
  onSelectDay: vi.fn(),
}

function renderHeatmap(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, onSelectDay: vi.fn(), ...overrides }
  const result = render(<AvailabilityHeatmap {...props} />)
  return { ...result, onSelectDay: props.onSelectDay }
}

test('AvailabilityHeatmap renders 7 day rows', () => {
  renderHeatmap()
  for (const label of ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
})

test('AvailabilityHeatmap cells with 7-9 total use tier-3 color', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/06:00 — śr\. 8 rowerów/)
  expect(cell.style.backgroundColor).toBe('var(--tier-3)')
})

test('AvailabilityHeatmap cells with 2-3 total use tier-1 color', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/08:00 — śr\. 3 rowery/)
  expect(cell.style.backgroundColor).toBe('var(--tier-1)')
})

test('AvailabilityHeatmap cells with 0-1 total use tier-0 color', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/12:00 — śr\. 1 rower/)
  expect(cell.style.backgroundColor).toBe('var(--tier-0)')
})

test('AvailabilityHeatmap cells with 4-6 total use tier-2 color', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/09:00 — śr\. 5 rowerów/)
  expect(cell.style.backgroundColor).toBe('var(--tier-2)')
})

test('AvailabilityHeatmap cells with 10+ total use tier-4 color', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/14:00 — śr\. 12 rowerów/)
  expect(cell.style.backgroundColor).toBe('var(--tier-4)')
})

test('AvailabilityHeatmap cells with no data use border color', () => {
  renderHeatmap()
  const cells = screen.getAllByTitle('05:00 — brak danych')
  expect(cells.length).toBe(7)
  for (const cell of cells) {
    expect(cell.style.backgroundColor).toBe('var(--color-border)')
  }
})

test('AvailabilityHeatmap selected day row has ring classes', () => {
  renderHeatmap({ selectedDay: 2 })
  const dayLabel = screen.getByText('Śr')
  const row = dayLabel.closest('.cursor-pointer')!
  expect(row.className).toContain('ring-1')
  expect(row.className).toContain('ring-accent')
})

test('AvailabilityHeatmap clicking a day row calls onSelectDay', async () => {
  const { onSelectDay } = renderHeatmap({ selectedDay: 0 })
  const tuesdayLabel = screen.getByText('Wt')
  await userEvent.click(tuesdayLabel.closest('.cursor-pointer')!)
  expect(onSelectDay).toHaveBeenCalledWith(1)
})

test('AvailabilityHeatmap renders hour tick labels every 3 hours', () => {
  renderHeatmap()
  for (const h of [5, 8, 11, 14, 17, 20]) {
    expect(screen.getByText(`${h}:00`)).toBeInTheDocument()
  }
})

test('AvailabilityHeatmap legend text is present', () => {
  renderHeatmap()
  expect(screen.getByText(/≥10 rowerów łącznie/)).toBeInTheDocument()
  expect(screen.getByText(/7–9/)).toBeInTheDocument()
  expect(screen.getByText(/4–6/)).toBeInTheDocument()
  expect(screen.getByText(/2–3/)).toBeInTheDocument()
  expect(screen.getByText(/0–1/)).toBeInTheDocument()
})

test('AvailabilityHeatmap with empty availability renders all border-colored cells', () => {
  renderHeatmap({ availability: [] })
  const noCells = screen.getAllByTitle(/brak danych/)
  expect(noCells.length).toBeGreaterThan(0)
  for (const cell of noCells) {
    expect(cell.style.backgroundColor).toBe('var(--color-border)')
  }
})
