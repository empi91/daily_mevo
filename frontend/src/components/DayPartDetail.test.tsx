import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DayPartDetail from './DayPartDetail'
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

test('DayPartDetail first section (Rano) is expanded by default', () => {
  renderDetail()
  expect(screen.getByText('06:00')).toBeInTheDocument()
})

test('DayPartDetail clicking a collapsed section expands it', async () => {
  renderDetail()
  const popButton = screen.getByText('Popołudnie').closest('button')!
  await userEvent.click(popButton)
  expect(screen.getByText('12:00')).toBeInTheDocument()
})

test('DayPartDetail expanded section shows per-slot bike counts and reliability badge', () => {
  renderDetail()
  const badges = screen.getAllByText('dostępne')
  expect(badges.length).toBeGreaterThan(0)
  expect(screen.getByText('niepewne')).toBeInTheDocument()
})

test('DayPartDetail reliability labels render correct Polish text', async () => {
  renderDetail()
  expect(screen.getAllByText('dostępne').length).toBeGreaterThan(0)
  expect(screen.getByText('niepewne')).toBeInTheDocument()

  const popButton = screen.getByText('Popołudnie').closest('button')!
  await userEvent.click(popButton)
  expect(screen.getByText('puste')).toBeInTheDocument()
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

test('DayPartDetail insufficient_data label renders as brak danych', () => {
  renderDetail(1)
  const ranoButton = screen.getByText('Rano').closest('button')!
  expect(ranoButton).toBeInTheDocument()
  expect(screen.getByText('brak danych')).toBeInTheDocument()
})
