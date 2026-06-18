import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RegisterPage from './RegisterPage'
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
    registerMutation: {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>['registerMutation'],
    logoutMutation: {} as ReturnType<typeof useAuth>['logoutMutation'],
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('RegisterPage renders email and password fields', () => {
  mockAuth()
  renderWithProviders(<RegisterPage />, { initialEntries: ['/register'] })

  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Hasło')).toBeInTheDocument()
})

test('RegisterPage shows validation error for short password', async () => {
  const mutateFn = vi.fn()
  mockAuth({
    registerMutation: {
      mutate: mutateFn,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>['registerMutation'],
  })
  renderWithProviders(<RegisterPage />, { initialEntries: ['/register'] })

  await userEvent.type(screen.getByLabelText('Email'), 'test@example.com')
  await userEvent.type(screen.getByLabelText('Hasło'), 'short')
  await userEvent.click(screen.getByRole('button', { name: 'Zarejestruj się' }))

  expect(screen.getByText('Hasło musi mieć co najmniej 8 znaków')).toBeInTheDocument()
  expect(mutateFn).not.toHaveBeenCalled()
})

test('RegisterPage shows error on REGISTER_USER_ALREADY_EXISTS', () => {
  mockAuth({
    registerMutation: {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error('REGISTER_USER_ALREADY_EXISTS'),
    } as unknown as ReturnType<typeof useAuth>['registerMutation'],
  })
  renderWithProviders(<RegisterPage />, { initialEntries: ['/register'] })

  expect(screen.getByText('Ten adres email jest już zarejestrowany')).toBeInTheDocument()
})

test('RegisterPage shows link to login page', () => {
  mockAuth()
  renderWithProviders(<RegisterPage />, { initialEntries: ['/register'] })

  const link = screen.getByRole('link', { name: 'Zaloguj się' })
  expect(link).toHaveAttribute('href', '/login')
})

test('RegisterPage submit button shows Rejestracja... while pending', () => {
  mockAuth({
    registerMutation: {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useAuth>['registerMutation'],
  })
  renderWithProviders(<RegisterPage />, { initialEntries: ['/register'] })

  expect(screen.getByRole('button', { name: 'Rejestracja...' })).toBeInTheDocument()
})
