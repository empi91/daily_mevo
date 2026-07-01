import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StationSearch from './StationSearch'
import { TEST_STATIONS } from '../test/fixtures'
import { renderWithRouter } from '../test/helpers'
import { geocodeAddress, fetchNearbyStations } from '../api/stations'

vi.mock('../api/stations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/stations')>()
  return {
    ...actual,
    geocodeAddress: vi.fn(),
    fetchNearbyStations: vi.fn(),
  }
})

const mockedGeocode = vi.mocked(geocodeAddress)
const mockedNearby = vi.mocked(fetchNearbyStations)

beforeEach(() => {
  vi.clearAllMocks()
})

function renderSearch(stations = TEST_STATIONS) {
  return renderWithRouter(<StationSearch stations={stations} />)
}

test('StationSearch typing a station name shows matching results', async () => {
  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Brama')
  expect(screen.getByText('Brama Wyżynna')).toBeInTheDocument()
})

test('StationSearch typing a station ID shows matching results', async () => {
  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), '4076')
  expect(screen.getByText('Brama Wyżynna')).toBeInTheDocument()
})

test('StationSearch typing an address substring shows matching results', async () => {
  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Jagiellońskie')
  expect(screen.getByText('Brama Wyżynna')).toBeInTheDocument()
})

test('StationSearch results are links to /stations/{station_id}', async () => {
  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Brama')
  const link = screen.getByRole('link', { name: /Brama Wyżynna/ })
  expect(link).toHaveAttribute('href', '/stations/4076')
})

test('StationSearch shows max 10 local results', async () => {
  const manyStations = Array.from({ length: 15 }, (_, i) => ({
    station_id: `${1000 + i}`,
    name: `Stacja Test ${i}`,
    address: 'ul. Testowa',
    lat: 54.35,
    lon: 18.64,
    capacity: 10,
  }))
  renderSearch(manyStations)
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Test')
  const links = screen.getAllByRole('link')
  expect(links).toHaveLength(10)
})

test('StationSearch empty query shows no results', () => {
  renderSearch()
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})

test('StationSearch no local matches with >= 3 chars triggers geocode fallback', async () => {
  mockedGeocode.mockResolvedValue({ lat: 54.35, lon: 18.64, display_name: 'Test' })
  mockedNearby.mockResolvedValue([
    {
      station_id: '9999',
      name: 'Nearby Station',
      address: 'ul. Bliska',
      lat: 54.351,
      lon: 18.641,
      capacity: 12,
      distance_m: 250,
    },
  ])

  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Nieznana ulica')

  await waitFor(() => {
    expect(screen.getByText('Nearby Station')).toBeInTheDocument()
  }, { timeout: 2000 })

  expect(mockedGeocode).toHaveBeenCalledWith('Nieznana ulica')
})

test('StationSearch nearby results show distance', async () => {
  mockedGeocode.mockResolvedValue({ lat: 54.35, lon: 18.64, display_name: 'Test' })
  mockedNearby.mockResolvedValue([
    {
      station_id: '9999',
      name: 'Nearby Station',
      address: 'ul. Bliska',
      lat: 54.351,
      lon: 18.641,
      capacity: 12,
      distance_m: 250,
    },
  ])

  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Nieznana ulica')

  await waitFor(() => {
    expect(screen.getByText('250 m')).toBeInTheDocument()
  }, { timeout: 2000 })
})

test('StationSearch geocode error shows Polish error message', async () => {
  mockedGeocode.mockRejectedValue(new Error('Not found'))

  renderSearch()
  await userEvent.type(screen.getByPlaceholderText(/Wpisz nazwę/), 'Nieznana ulica')

  await waitFor(() => {
    expect(screen.getByText(/Nie znaleziono adresu/)).toBeInTheDocument()
  }, { timeout: 2000 })
})
