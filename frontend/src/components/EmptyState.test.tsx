import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'

test('EmptyState renders its heading text', () => {
  render(<EmptyState />)
  expect(screen.getByText('Dane wciąż zbierane')).toBeInTheDocument()
})
