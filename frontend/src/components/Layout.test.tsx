import { screen } from '@testing-library/react'
import Layout from './Layout'
import { renderWithProviders, createMockAuthValue } from '../test/helpers'
import { useAuth } from '../hooks/useAuth'

vi.mock('../hooks/useAuth')

const mockedUseAuth = vi.mocked(useAuth)

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue(createMockAuthValue(overrides))
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('Layout shows login and register links when unauthenticated', () => {
  mockAuth()
  renderWithProviders(<Layout />)
  expect(screen.getByRole('link', { name: 'Zaloguj się' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Zarejestruj się' })).toBeInTheDocument()
})

test('Layout shows user email and logout button when authenticated', () => {
  mockAuth({
    user: { id: '1', email: 'user@test.com', is_active: true, is_superuser: false, is_verified: true },
    isAuthenticated: true,
  })
  renderWithProviders(<Layout />)
  expect(screen.getByText('user@test.com')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Wyloguj' })).toBeInTheDocument()
})

test('Layout shows MevoStats brand link', () => {
  mockAuth()
  renderWithProviders(<Layout />)
  const brand = screen.getByRole('link', { name: 'MevoStats' })
  expect(brand).toHaveAttribute('href', '/')
})

test('Layout renders the footer text', () => {
  mockAuth()
  renderWithProviders(<Layout />)
  expect(screen.getByText('Dane z Mevo Open Data API (GBFS)')).toBeInTheDocument()
})
