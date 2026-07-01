import { screen } from '@testing-library/react'
import PopularStations from './PopularStations'
import { renderWithProviders } from '../test/helpers'
import { fetchPopularStations } from '../api/stations'
import type { FavouriteStation } from '../api/favourites'

vi.mock('../api/stations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/stations')>()
  return {
    ...actual,
    fetchPopularStations: vi.fn(),
  }
})

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
    isLoading: false,
    loginMutation: { mutate: vi.fn(), isPending: false, isError: false },
    registerMutation: { mutate: vi.fn(), isPending: false, isError: false },
    logoutMutation: { mutate: vi.fn(), isPending: false, isError: false },
  }),
}))

vi.mock('../hooks/useFavourites', () => ({
  useFavourites: () => ({
    favourites: [],
    isLoading: false,
    isFavourite: () => false,
    addMutation: { mutate: vi.fn(), isPending: false, isError: false },
    removeMutation: { mutate: vi.fn(), isPending: false, isError: false },
  }),
}))

const mockedFetchPopular = vi.mocked(fetchPopularStations)

const TEST_POPULAR: FavouriteStation[] = [
  {
    station_id: '4076',
    name: 'Brama Wyżynna',
    address: 'ul. Wały Jagiellońskie',
    lat: 54.352,
    lon: 18.6466,
    capacity: 24,
    avg_bikes: 5,
    avg_ebikes: 3,
    reliability_label: 'reliable',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

test('PopularStations renders featured station cards as links', async () => {
  mockedFetchPopular.mockResolvedValue(TEST_POPULAR)
  renderWithProviders(<PopularStations />)

  const link = await screen.findByRole('link', { name: /Brama Wyżynna/ })
  expect(link).toHaveAttribute('href', '/stations/4076')
})

test('PopularStations each card shows station name and address', async () => {
  mockedFetchPopular.mockResolvedValue(TEST_POPULAR)
  renderWithProviders(<PopularStations />)

  await screen.findByText('Brama Wyżynna')
  expect(screen.getByText('ul. Wały Jagiellońskie')).toBeInTheDocument()
})

test('PopularStations shows availability data', async () => {
  mockedFetchPopular.mockResolvedValue(TEST_POPULAR)
  renderWithProviders(<PopularStations />)

  await screen.findByText('Statystycznie o tej godzinie:')
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('rowery elektryczne')).toBeInTheDocument()
})

test('PopularStations returns null when no stations', async () => {
  mockedFetchPopular.mockResolvedValue([])
  const { container } = renderWithProviders(<PopularStations />)

  await vi.waitFor(() => {
    expect(mockedFetchPopular).toHaveBeenCalled()
  })

  expect(container.querySelector('section')).not.toBeInTheDocument()
})
