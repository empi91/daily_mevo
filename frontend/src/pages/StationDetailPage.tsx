import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchStationDetail } from '../api/stations'
import AvailabilityHeatmap from '../components/AvailabilityHeatmap'
import DayOfWeekTabs from '../components/DayOfWeekTabs'
import DayPartDetail from '../components/DayPartDetail'
import EmptyState from '../components/EmptyState'
import FavouriteToggleButton from '../components/FavouriteToggleButton'

const MIN_SAMPLE_COUNT = 1

function currentDayOfWeek(): number {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

export default function StationDetailPage() {
  const { stationId } = useParams<{ stationId: string }>()
  const [selectedDay, setSelectedDay] = useState(currentDayOfWeek)

  const { data: station, isLoading, error } = useQuery({
    queryKey: ['station', stationId],
    queryFn: () => fetchStationDetail(stationId!),
    enabled: !!stationId,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="max-w-[920px] mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-8 w-64 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-4 w-48 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-48 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>
      </div>
    )
  }

  if (error || !station) {
    const is404 = error instanceof Error && error.message.includes('404')
    return (
      <div className="max-w-[920px] mx-auto px-4 py-8">
        <Link to="/" className="text-accent hover:underline text-sm">
          &larr; Wróć do wyszukiwania
        </Link>
        <div className="mt-8 text-center">
          <h1 className="text-2xl font-extrabold text-text mb-2">
            {is404 ? 'Stacja nie znaleziona' : 'Błąd ładowania'}
          </h1>
          <p className="text-muted">
            {is404
              ? `Nie znaleziono stacji o ID "${stationId}".`
              : 'Wystąpił problem z ładowaniem danych. Spróbuj ponownie.'}
          </p>
        </div>
      </div>
    )
  }

  const hasData =
    station.availability.length > 0 &&
    station.availability.some((s) => s.sample_count >= MIN_SAMPLE_COUNT)

  return (
    <div className="max-w-[920px] mx-auto px-4 py-8">
      <Link to="/" className="text-accent hover:underline text-sm">
        &larr; Wróć do wyszukiwania
      </Link>

      {/* Station metadata */}
      <div className="mt-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] font-extrabold text-text">{station.name}</h1>
          <FavouriteToggleButton stationId={station.station_id} />
        </div>
        <p className="mt-2 text-sm font-semibold text-muted">
          ID: {station.station_id}
          {station.address && <> · {station.address}</>}
          {station.capacity && <> · Pojemność: {station.capacity}</>}
        </p>
      </div>

      {!hasData ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {/* Heatmap */}
          <section>
            <h2 className="text-base font-extrabold text-text mb-3">
              Dostępność w ciągu tygodnia
            </h2>
            <AvailabilityHeatmap
              availability={station.availability}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </section>

          {/* Day tabs + detail */}
          <section>
            <h2 className="text-base font-extrabold text-text mb-3">Szczegóły dnia</h2>
            <DayOfWeekTabs selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            <div className="mt-4">
              <DayPartDetail availability={station.availability} selectedDay={selectedDay} />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
