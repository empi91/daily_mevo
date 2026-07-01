import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import DayPartDetail from './DayPartDetail'
import { currentDayPartIndex } from './dayParts'
import { TEST_AVAILABILITY } from '../test/fixtures'

function renderDetail(selectedDay = 0) {
  return render(
    <DayPartDetail availability={TEST_AVAILABILITY} selectedDay={selectedDay} />,
  )
}

test('DayPartDetail renders 4 day-part sections', () => {
  renderDetail()
  expect(screen.getByText('Rano')).toBeInTheDocument()
  expect(screen.getByText('Popołudnie')).toBeInTheDocument()
  expect(screen.getByText('Wieczór')).toBeInTheDocument()
  expect(screen.getByText('Noc')).toBeInTheDocument()
})

test('DayPartDetail shows time ranges', () => {
  renderDetail()
  expect(screen.getByText('6–12')).toBeInTheDocument()
  expect(screen.getByText('12–18')).toBeInTheDocument()
  expect(screen.getByText('18–22')).toBeInTheDocument()
  expect(screen.getByText('22–6')).toBeInTheDocument()
})

test('DayPartDetail expands section matching current time of day', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 21, 14, 0, 0))
  renderDetail()
  expect(screen.getByText('12:00')).toBeInTheDocument()
  vi.useRealTimers()
})

test('DayPartDetail clicking a collapsed section expands it', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 21, 20, 0, 0))
  renderDetail()
  vi.useRealTimers()
  const popButton = screen.getByText('Popołudnie').closest('button')!
  await userEvent.click(popButton)
  expect(screen.getByText('12:00')).toBeInTheDocument()
})

test('DayPartDetail expanded section shows per-slot bike counts in tile layout', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 21, 8, 0, 0))
  renderDetail()
  expect(screen.getByText('06:00')).toBeInTheDocument()
  expect(screen.getByText('08:00')).toBeInTheDocument()
  expect(screen.getByText('średnio · niepewne')).toBeInTheDocument()
  vi.useRealTimers()
})

test('DayPartDetail reliable slots show średnio without niepewne', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 21, 8, 0, 0))
  renderDetail()
  const srednioElements = screen.getAllByText('średnio')
  expect(srednioElements.length).toBeGreaterThan(0)
  vi.useRealTimers()
})

test('DayPartDetail section header shows average bike count', () => {
  renderDetail()
  const ranoButton = screen.getByText('Rano').closest('button')!
  expect(ranoButton.textContent).toContain('średnio')
})

test('DayPartDetail no data for a period shows empty message', () => {
  renderDetail(3)
  expect(screen.getAllByText('Brak danych dla tego okresu').length).toBeGreaterThan(0)
})

test('DayPartDetail insufficient_data label renders tile without niepewne', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 5, 21, 8, 0, 0))
  renderDetail(1)
  const srednioElements = screen.getAllByText('średnio')
  expect(srednioElements.length).toBeGreaterThan(0)
  vi.useRealTimers()
})

describe('currentDayPartIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test.each([
    { hour: 8, expected: 0, label: 'Morning (8:00)' },
    { hour: 14, expected: 1, label: 'Afternoon (14:00)' },
    { hour: 20, expected: 2, label: 'Evening (20:00)' },
    { hour: 23, expected: 3, label: 'Night late (23:00)' },
    { hour: 3, expected: 3, label: 'Night early/wrap-around (3:00)' },
    { hour: 6, expected: 0, label: 'Boundary: start of Morning (6:00)' },
    { hour: 12, expected: 1, label: 'Boundary: start of Afternoon (12:00)' },
    { hour: 18, expected: 2, label: 'Boundary: start of Evening (18:00)' },
    { hour: 22, expected: 3, label: 'Boundary: start of Night (22:00)' },
  ])('returns index $expected for $label', ({ hour, expected }) => {
    vi.setSystemTime(new Date(2026, 5, 21, hour, 0, 0))
    expect(currentDayPartIndex()).toBe(expected)
  })
})
