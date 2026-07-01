import { screen } from '@testing-library/react'
import HomePage from './HomePage'
import { renderWithProviders, createMockAuthValue } from '../test/helpers'
import { TEST_STATIONS } from '../test/fixtures'
import { fetchStations } from '../api/stations'
import { useAuth } from '../hooks/useAuth'
import { useFavourites } from '../hooks/useFavourites'
import type { FavouriteStation } from '../api/favourites'

vi.mock('../api/stations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/stations')>()
  return {
    ...actual,
    fetchStations: vi.fn(),
    fetchPopularStations: vi.fn().mockResolvedValue([{
      station_id: '4076',
      name: 'Brama Wyżynna',
      address: 'ul. Wały Jagiellońskie',
      lat: 54.352,
      lon: 18.6466,
      capacity: 24,
      avg_bikes: 5,
      avg_ebikes: 3,
      reliability_label: 'reliable',
    }]),
  }
})

vi.mock('../hooks/useAuth')
vi.mock('../hooks/useFavourites')

const mockedFetchStations = vi.mocked(fetchStations)
const mockedUseAuth = vi.mocked(useAuth)
const mockedUseFavourites = vi.mocked(useFavourites)

const testFavourite: FavouriteStation = {
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

function mockDefaults(
  authOverrides: Partial<ReturnType<typeof useAuth>> = {},
  favourites: FavouriteStation[] = [],
) {
  mockedUseAuth.mockReturnValue(createMockAuthValue(authOverrides))
  mockedUseFavourites.mockReturnValue({
    favourites,
    isLoading: false,
    addMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['addMutation'],
    removeMutation: { mutate: vi.fn(), isPending: false, isError: false, variables: undefined } as unknown as ReturnType<typeof useFavourites>['removeMutation'],
    isFavourite: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedFetchStations.mockResolvedValue(TEST_STATIONS)
})

test('HomePage renders the heading MevoStats', () => {
  mockDefaults()
  renderWithProviders(<HomePage />)
  expect(screen.getByRole('heading', { name: 'MevoStats' })).toBeInTheDocument()
})

test('HomePage renders the search input placeholder', () => {
  mockDefaults()
  renderWithProviders(<HomePage />)
  expect(screen.getByPlaceholderText(/Wpisz nazwę lub adres stacji/)).toBeInTheDocument()
})

test('shows "Popularne stacje" when not authenticated', async () => {
  mockDefaults({ isAuthenticated: false })
  renderWithProviders(<HomePage />)

  expect(await screen.findByText('Popularne stacje')).toBeInTheDocument()
  expect(screen.queryByText('Twoje ulubione stacje')).not.toBeInTheDocument()
})

test('shows "Twoje ulubione stacje" when authenticated with favourites', () => {
  mockDefaults({ isAuthenticated: true, user: { id: '1', email: 'test@test.com', is_active: true, is_superuser: false, is_verified: true } }, [testFavourite])
  renderWithProviders(<HomePage />)

  expect(screen.getByText('Twoje ulubione stacje')).toBeInTheDocument()
  expect(screen.queryByText('Popularne stacje')).not.toBeInTheDocument()
})

test('falls back to "Popularne stacje" when authenticated with no favourites', async () => {
  mockDefaults({ isAuthenticated: true, user: { id: '1', email: 'test@test.com', is_active: true, is_superuser: false, is_verified: true } }, [])
  renderWithProviders(<HomePage />)

  expect(await screen.findByText('Popularne stacje')).toBeInTheDocument()
  expect(screen.queryByText('Twoje ulubione stacje')).not.toBeInTheDocument()
})
