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

test('AvailabilityHeatmap cells with reliable data have bg-green-500', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/06:00 — śr\. 8 rowerów/)
  expect(cell.className).toContain('bg-green-500')
})

test('AvailabilityHeatmap cells with uncertain data have bg-yellow-400', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/08:00 — śr\. 3 rowery/)
  expect(cell.className).toContain('bg-yellow-400')
})

test('AvailabilityHeatmap cells with empty data have bg-red-500', () => {
  renderHeatmap()
  const cell = screen.getByTitle(/12:00 — śr\. 1 rower/)
  expect(cell.className).toContain('bg-red-500')
})

test('AvailabilityHeatmap cells with no data have bg-gray-200', () => {
  renderHeatmap()
  const cells = screen.getAllByTitle('05:00 — brak danych')
  expect(cells.length).toBe(7)
  for (const cell of cells) {
    expect(cell.className).toContain('bg-gray-200')
  }
})

test('AvailabilityHeatmap selected day row has ring classes', () => {
  renderHeatmap({ selectedDay: 2 })
  const dayLabel = screen.getByText('Śr')
  const row = dayLabel.parentElement!
  expect(row.className).toContain('ring-1')
  expect(row.className).toContain('ring-blue-300')
})

test('AvailabilityHeatmap clicking a day row calls onSelectDay', async () => {
  const { onSelectDay } = renderHeatmap({ selectedDay: 0 })
  const tuesdayLabel = screen.getByText('Wt')
  await userEvent.click(tuesdayLabel.parentElement!)
  expect(onSelectDay).toHaveBeenCalledWith(1)
})

test('AvailabilityHeatmap renders hour labels from 5:00 to 22:00', () => {
  renderHeatmap()
  expect(screen.getByText('5:00')).toBeInTheDocument()
  expect(screen.getByText('12:00')).toBeInTheDocument()
  expect(screen.getByText('22:00')).toBeInTheDocument()
})

test('AvailabilityHeatmap legend text is present', () => {
  renderHeatmap()
  expect(screen.getByText(/≥6 rowerów łącznie/)).toBeInTheDocument()
  expect(screen.getByText(/2–5 rowerów łącznie/)).toBeInTheDocument()
  expect(screen.getByText(/≤1 rower łącznie/)).toBeInTheDocument()
  expect(screen.getByText(/brak danych/)).toBeInTheDocument()
})

test('AvailabilityHeatmap with empty availability renders all gray cells', () => {
  renderHeatmap({ availability: [] })
  const noCells = screen.getAllByTitle(/brak danych/)
  expect(noCells.length).toBeGreaterThan(0)
  for (const cell of noCells) {
    expect(cell.className).toContain('bg-gray-200')
  }
})
