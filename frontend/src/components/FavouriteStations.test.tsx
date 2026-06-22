import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FavouriteStations from './FavouriteStations'
import { renderWithProviders } from '../test/helpers'
import { useFavourites } from '../hooks/useFavourites'
import type { FavouriteStation } from '../api/favourites'

vi.mock('../hooks/useFavourites')

const mockedUseFavourites = vi.mocked(useFavourites)

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

const removeMutate = vi.fn()

function mockFavourites(favourites: FavouriteStation[] = testFavourites) {
  mockedUseFavourites.mockReturnValue({
    favourites,
    isLoading: false,
    addMutation: { mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useFavourites>['addMutation'],
    removeMutation: { mutate: removeMutate, isPending: false, isError: false, variables: undefined } as unknown as ReturnType<typeof useFavourites>['removeMutation'],
    isFavourite: vi.fn(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('returns null when favourites list is empty', () => {
  mockFavourites([])
  const { container } = renderWithProviders(<FavouriteStations />)
  expect(container.innerHTML).toBe('')
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

  expect(screen.getByText('3 rowery elektryczne')).toBeInTheDocument()
  expect(screen.getByText('5 rowerów zwykłych')).toBeInTheDocument()
})

test('shows "Brak danych" when availability fields are null', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  expect(screen.getByText('Brak danych')).toBeInTheDocument()
})

test('remove button click calls removeMutation', async () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  const removeButtons = screen.getAllByRole('button', { name: /Usuń .+ z ulubionych/ })
  await userEvent.click(removeButtons[0])

  expect(removeMutate).toHaveBeenCalledWith('4076')
})

test('cards link to correct station detail URLs', () => {
  mockFavourites()
  renderWithProviders(<FavouriteStations />)

  const link = screen.getByRole('link', { name: /Brama Wyżynna/ })
  expect(link).toHaveAttribute('href', '/stations/4076')

  const link2 = screen.getByRole('link', { name: /Dworzec Główny/ })
  expect(link2).toHaveAttribute('href', '/stations/3839')
})
