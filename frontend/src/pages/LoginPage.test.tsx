import { screen } from '@testing-library/react'
import LoginPage from './LoginPage'
import { renderWithProviders } from '../test/helpers'
import { useAuth } from '../hooks/useAuth'

vi.mock('../hooks/useAuth')

const mockedUseAuth = vi.mocked(useAuth)

function mockAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  mockedUseAuth.mockReturnValue({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    loginMutation: {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>['loginMutation'],
    registerMutation: {} as ReturnType<typeof useAuth>['registerMutation'],
    logoutMutation: {} as ReturnType<typeof useAuth>['logoutMutation'],
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('LoginPage renders email and password fields with correct labels', () => {
  mockAuth()
  renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })

  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Hasło')).toBeInTheDocument()
})

test('LoginPage renders Zaloguj się submit button', () => {
  mockAuth()
  renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })

  expect(screen.getByRole('button', { name: 'Zaloguj się' })).toBeInTheDocument()
})

test('LoginPage shows error on LOGIN_BAD_CREDENTIALS', () => {
  mockAuth({
    loginMutation: {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('LOGIN_BAD_CREDENTIALS'),
    } as unknown as ReturnType<typeof useAuth>['loginMutation'],
  })
  renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })

  expect(screen.getByText('Nieprawidłowy email lub hasło')).toBeInTheDocument()
})

test('LoginPage shows link to register page', () => {
  mockAuth()
  renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })

  const link = screen.getByRole('link', { name: 'Zarejestruj się' })
  expect(link).toHaveAttribute('href', '/register')
})

test('LoginPage submit button shows Logowanie... while pending', () => {
  mockAuth({
    loginMutation: {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>['loginMutation'],
  })
  renderWithProviders(<LoginPage />, { initialEntries: ['/login'] })

  expect(screen.getByRole('button', { name: 'Logowanie...' })).toBeInTheDocument()
})
