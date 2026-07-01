import { screen } from '@testing-library/react'
import FavouriteStations from './FavouriteStations'
import { renderWithProviders } from '../test/helpers'
import { useFavourites } from '../hooks/useFavourites'
import { useAuth } from '../hooks/useAuth'
import type { FavouriteStation } from '../api/favourites'

vi.mock('../hooks/useFavourites')
vi.mock('../hooks/useAuth')

const mockedUseFavourites = vi.mocked(useFavourites)
const mockedUseAuth = vi.mocked(useAuth)

const testFavourites: FavouriteStation[] = [
  {
    station_id: '4076',
    name: 'Brama Wyżynna',
    address: 'ul. Wały Jagiellońskie',
    lat: 54.352,
    lon: 18.6466,
    capacity: 24,
    avg_bikes: 5,
    avg_ebikes: 3,
    reliability_label: 'Niezawodna',
  },
  {
    station_id: '3839',
    name: 'Dworzec Główny',
    address: 'ul. Podwale Grodzkie 1',
    lat: 54.3559,
    lon: 18.644,
    capacity: 30,
    avg_bikes: null,
    avg_ebikes: null,
    reliability_label: null,
  },
]

function mockFavourites(favourites: FavouriteStation[] = testFavourites) {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: false,
    user: null,
    isLoading: false,
    loginMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useAuth>['loginMutation'],
    registerMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useAuth>['registerMutation'],
    logoutMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useAuth>['logoutMutation'],
  })
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
})

test('returns null when favourites list is empty', () => {
  mockFavourites([])
  const { container } = renderWithProviders(<FavouriteStations />)
  expect(container.querySelector('section')).not.toBeInTheDocument()
})

test('renders cards with station names and addresses', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  expect(screen.getByText('Brama Wyżynna')).toBeInTheDocument()
  expect(screen.getByText('ul. Wały Jagiellońskie')).toBeInTheDocument()
  expect(screen.getByText('Dworzec Główny')).toBeInTheDocument()
  expect(screen.getByText('ul. Podwale Grodzkie 1')).toBeInTheDocument()
})

test('renders availability data when available', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  expect(screen.getByText('rowery elektryczne')).toBeInTheDocument()
  expect(screen.getByText('rowerów zwykłych')).toBeInTheDocument()
})

test('shows "Brak danych" when availability fields are null', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  expect(screen.getByText('Brak danych')).toBeInTheDocument()
})

test('cards link to correct station detail URLs', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  const link = screen.getByRole('link', { name: /Brama Wyżynna/ })
  expect(link).toHaveAttribute('href', '/stations/4076')

  const link2 = screen.getByRole('link', { name: /Dworzec Główny/ })
  expect(link2).toHaveAttribute('href', '/stations/3839')
})
