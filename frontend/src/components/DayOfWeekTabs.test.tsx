import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DayOfWeekTabs from './DayOfWeekTabs'

test('DayOfWeekTabs renders 7 buttons with Polish day labels', () => {
  render(<DayOfWeekTabs selectedDay={0} onSelectDay={vi.fn()} />)
  for (const label of ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  }
})

test('DayOfWeekTabs selected day button has bg-accent', () => {
  render(<DayOfWeekTabs selectedDay={2} onSelectDay={vi.fn()} />)
  const selected = screen.getByRole('button', { name: 'Śr' })
  expect(selected.className).toContain('bg-accent')
})

test('DayOfWeekTabs clicking a tab calls onSelectDay with correct index', async () => {
  const onSelectDay = vi.fn()
  render(<DayOfWeekTabs selectedDay={0} onSelectDay={onSelectDay} />)
  await userEvent.click(screen.getByRole('button', { name: 'Pt' }))
  expect(onSelectDay).toHaveBeenCalledWith(4)
})
