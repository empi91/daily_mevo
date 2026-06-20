import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useFavourites } from './useFavourites'
import { useAuth } from './useAuth'
import * as favouritesApi from '../api/favourites'

vi.mock('./useAuth')
vi.mock('../api/favourites')

const mockedUseAuth = vi.mocked(useAuth)
const mockedFetchFavourites = vi.mocked(favouritesApi.fetchFavourites)
const mockedAddFavourite = vi.mocked(favouritesApi.addFavourite)
const mockedRemoveFavourite = vi.mocked(favouritesApi.removeFavourite)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function mockAuth(isAuthenticated: boolean) {
  mockedUseAuth.mockReturnValue({
    user: isAuthenticated ? { id: '1', email: 'test@test.com' } : null,
    isLoading: false,
    isAuthenticated,
    loginMutation: {} as ReturnType<typeof useAuth>['loginMutation'],
    registerMutation: {} as ReturnType<typeof useAuth>['registerMutation'],
    logoutMutation: {} as ReturnType<typeof useAuth>['logoutMutation'],
  })
}

const testStation: favouritesApi.FavouriteStation = {
  station_id: '4076',
  name: 'Brama Wyżynna',
  address: 'ul. Wały Jagiellońskie',
  lat: 54.352,
  lon: 18.6466,
  capacity: 24,
  avg_bikes: 5,
  avg_ebikes: 3,
  reliability_label: 'Niezawodna',
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('does not fetch when not authenticated', () => {
  mockAuth(false)
  renderHook(() => useFavourites(), { wrapper: createWrapper() })
  expect(mockedFetchFavourites).not.toHaveBeenCalled()
})

test('fetches and returns favourites when authenticated', async () => {
  mockAuth(true)
  mockedFetchFavourites.mockResolvedValue([testStation])

  const { result } = renderHook(() => useFavourites(), { wrapper: createWrapper() })

  await waitFor(() => {
    expect(result.current.favourites).toHaveLength(1)
  })
  expect(result.current.favourites[0].station_id).toBe('4076')
})

test('isFavourite returns correct boolean', async () => {
  mockAuth(true)
  mockedFetchFavourites.mockResolvedValue([testStation])

  const { result } = renderHook(() => useFavourites(), { wrapper: createWrapper() })

  await waitFor(() => {
    expect(result.current.favourites).toHaveLength(1)
  })
  expect(result.current.isFavourite('4076')).toBe(true)
  expect(result.current.isFavourite('9999')).toBe(false)
})

test('add mutation calls API', async () => {
  mockAuth(true)
  mockedFetchFavourites.mockResolvedValue([])
  mockedAddFavourite.mockResolvedValue(undefined)

  const { result } = renderHook(() => useFavourites(), { wrapper: createWrapper() })

  await waitFor(() => {
    expect(mockedFetchFavourites).toHaveBeenCalled()
  })

  result.current.addMutation.mutate('4076')

  await waitFor(() => {
    expect(mockedAddFavourite).toHaveBeenCalled()
    expect(mockedAddFavourite.mock.calls[0][0]).toBe('4076')
  })
})

test('remove mutation calls API', async () => {
  mockAuth(true)
  mockedFetchFavourites.mockResolvedValue([testStation])
  mockedRemoveFavourite.mockResolvedValue(undefined)

  const { result } = renderHook(() => useFavourites(), { wrapper: createWrapper() })

  await waitFor(() => {
    expect(result.current.favourites).toHaveLength(1)
  })

  result.current.removeMutation.mutate('4076')

  await waitFor(() => {
    expect(mockedRemoveFavourite).toHaveBeenCalled()
    expect(mockedRemoveFavourite.mock.calls[0][0]).toBe('4076')
  })
})
