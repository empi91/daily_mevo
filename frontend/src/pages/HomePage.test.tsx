import { screen } from '@testing-library/react'
import HomePage from './HomePage'
import { renderWithProviders } from '../test/helpers'
import { TEST_STATIONS } from '../test/fixtures'
import { fetchStations } from '../api/stations'

vi.mock('../api/stations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/stations')>()
  return {
    ...actual,
    fetchStations: vi.fn(),
  }
})

const mockedFetchStations = vi.mocked(fetchStations)

beforeEach(() => {
  vi.clearAllMocks()
})

test('HomePage renders the heading MevoStats', () => {
  mockedFetchStations.mockResolvedValue([])
  renderWithProviders(<HomePage />)
  expect(screen.getByRole('heading', { name: 'MevoStats' })).toBeInTheDocument()
})

test('HomePage renders the search input placeholder', () => {
  mockedFetchStations.mockResolvedValue([])
  renderWithProviders(<HomePage />)
  expect(screen.getByPlaceholderText(/Wpisz numer stacji, nazwę lub adres/)).toBeInTheDocument()
})

test('HomePage renders Popularne stacje section when station data is available', async () => {
  mockedFetchStations.mockResolvedValue(TEST_STATIONS)
  renderWithProviders(<HomePage />)

  expect(await screen.findByText('Popularne stacje')).toBeInTheDocument()
})
