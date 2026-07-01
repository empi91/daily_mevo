import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ThemeProvider from '../hooks/ThemeProvider'
import type { useAuth } from '../hooks/useAuth'

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithRouter(
  ui: ReactElement,
  { initialEntries = ['/'] }: { initialEntries?: string[] } = {},
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>,
  )
}

type AuthReturn = ReturnType<typeof useAuth>

const defaultMutationStub = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
}

export function createMockAuthValue(overrides: Partial<AuthReturn> = {}): AuthReturn {
  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
    loginMutation: { ...defaultMutationStub } as unknown as AuthReturn['loginMutation'],
    registerMutation: { ...defaultMutationStub } as unknown as AuthReturn['registerMutation'],
    logoutMutation: { ...defaultMutationStub } as unknown as AuthReturn['logoutMutation'],
    ...overrides,
  }
}

export function renderWithProviders(
  ui: ReactElement,
  {
    initialEntries = ['/'],
    queryClient = createTestQueryClient(),
  }: { initialEntries?: string[]; queryClient?: QueryClient } = {},
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}
