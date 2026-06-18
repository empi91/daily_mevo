import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import StationDetailPage from './StationDetailPage'
import { renderWithProviders } from '../test/helpers'
import { TEST_STATION_DETAIL } from '../test/fixtures'
import { fetchStationDetail } from '../api/stations'

vi.mock('../api/stations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/stations')>()
  return {
    ...actual,
    fetchStationDetail: vi.fn(),
  }
})

const mockedFetchDetail = vi.mocked(fetchStationDetail)

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage(stationId = '4076') {
  return renderWithProviders(
    <Routes>
      <Route path="/stations/:stationId" element={<StationDetailPage />} />
    </Routes>,
    { initialEntries: [`/stations/${stationId}`] },
  )
}

test('StationDetailPage renders loading skeleton initially', () => {
  mockedFetchDetail.mockReturnValue(new Promise(() => {}))
  renderPage()
  expect(screen.getByText((_, el) => el?.classList.contains('animate-pulse') ?? false)).toBeInTheDocument()
})

test('StationDetailPage renders station name, ID, address, and capacity after data loads', async () => {
  mockedFetchDetail.mockResolvedValue(TEST_STATION_DETAIL)
  renderPage()

  expect(await screen.findByText('Brama Wyżynna')).toBeInTheDocument()
  expect(screen.getByText(/ID: 4076/)).toBeInTheDocument()
  expect(screen.getByText(/ul\. Wały Jagiellońskie/)).toBeInTheDocument()
  expect(screen.getByText(/Pojemność: 24/)).toBeInTheDocument()
})

test('StationDetailPage renders AvailabilityHeatmap section heading', async () => {
  mockedFetchDetail.mockResolvedValue(TEST_STATION_DETAIL)
  renderPage()

  expect(await screen.findByText('Dostępność w ciągu tygodnia')).toBeInTheDocument()
})

test('StationDetailPage renders DayOfWeekTabs and DayPartDetail section', async () => {
  mockedFetchDetail.mockResolvedValue(TEST_STATION_DETAIL)
  renderPage()

  expect(await screen.findByText('Szczegóły dnia')).toBeInTheDocument()
})

test('StationDetailPage shows EmptyState when availability is empty', async () => {
  mockedFetchDetail.mockResolvedValue({
    ...TEST_STATION_DETAIL,
    availability: [],
  })
  renderPage()

  expect(await screen.findByText('Dane wciąż zbierane')).toBeInTheDocument()
})

test('StationDetailPage shows EmptyState when all samples below threshold', async () => {
  mockedFetchDetail.mockResolvedValue({
    ...TEST_STATION_DETAIL,
    availability: TEST_STATION_DETAIL.availability.map(s => ({ ...s, sample_count: 0 })),
  })
  renderPage()

  expect(await screen.findByText('Dane wciąż zbierane')).toBeInTheDocument()
})

test('StationDetailPage shows 404 message when station not found', async () => {
  mockedFetchDetail.mockRejectedValue(new Error('404 Not Found'))
  renderPage('9999')

  expect(await screen.findByText('Stacja nie znaleziona')).toBeInTheDocument()
  expect(screen.getByText(/Nie znaleziono stacji o ID "9999"/)).toBeInTheDocument()
})

test('StationDetailPage shows error message on fetch failure', async () => {
  mockedFetchDetail.mockRejectedValue(new Error('Server error'))
  renderPage()

  expect(await screen.findByText('Błąd ładowania')).toBeInTheDocument()
})

test('StationDetailPage back link points to home', async () => {
  mockedFetchDetail.mockResolvedValue(TEST_STATION_DETAIL)
  renderPage()

  await screen.findByText('Brama Wyżynna')
  const backLink = screen.getByRole('link', { name: /Wróć do wyszukiwania/ })
  expect(backLink).toHaveAttribute('href', '/')
})
