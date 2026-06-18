import { screen } from '@testing-library/react'
import PopularStations from './PopularStations'
import { renderWithProviders } from '../test/helpers'
import { fetchStations } from '../api/stations'
import { TEST_STATIONS } from '../test/fixtures'

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

test('PopularStations renders featured station cards as links', async () => {
  mockedFetchStations.mockResolvedValue(TEST_STATIONS)
  renderWithProviders(<PopularStations />)

  const link = await screen.findByRole('link', { name: /Brama Wyżynna/ })
  expect(link).toHaveAttribute('href', '/stations/4076')
})

test('PopularStations each card shows station name and address', async () => {
  mockedFetchStations.mockResolvedValue(TEST_STATIONS)
  renderWithProviders(<PopularStations />)

  await screen.findByText('Brama Wyżynna')
  expect(screen.getByText('ul. Wały Jagiellońskie')).toBeInTheDocument()
})

test('PopularStations returns null when no stations match featured IDs', async () => {
  mockedFetchStations.mockResolvedValue([
    {
      station_id: '9999',
      name: 'Not Featured',
      address: null,
      lat: 54.0,
      lon: 18.0,
      capacity: 10,
    },
  ])
  const { container } = renderWithProviders(<PopularStations />)

  await vi.waitFor(() => {
    expect(mockedFetchStations).toHaveBeenCalled()
  })

  expect(container.querySelector('section')).not.toBeInTheDocument()
})
