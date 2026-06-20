import { Link } from 'react-router-dom'
import { useFavourites } from '../hooks/useFavourites'

export default function FavouriteStations() {
  const { favourites, removeMutation } = useFavourites()

  if (favourites.length === 0) return null

  function formatAvailability(avgBikes: number | null, avgEbikes: number | null, label: string | null) {
    if (avgBikes === null || avgEbikes === null) return null
    const bikes = Math.round(avgBikes)
    const ebikes = Math.round(avgEbikes)
    const parts = []
    if (bikes > 0) parts.push(`${bikes} rower${bikes === 1 ? '' : bikes < 5 ? 'y' : 'ów'}`)
    if (ebikes > 0) parts.push(`${ebikes} e-rower${ebikes === 1 ? '' : ebikes < 5 ? 'y' : 'ów'}`)
    const availability = parts.length > 0 ? `≈ ${parts.join(' + ')}` : '≈ 0 rowerów'
    return label ? `${availability} · ${label}` : availability
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Twoje ulubione stacje</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {favourites.map((station) => (
          <div key={station.station_id} className="relative">
            <Link
              to={`/stations/${station.station_id}`}
              className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <span className="font-mono text-sm text-blue-600">{station.name}</span>
              {station.address && <p className="text-sm text-gray-500 mt-1">{station.address}</p>}
              <p className="text-sm mt-2 text-gray-700">
                {formatAvailability(station.avg_bikes, station.avg_ebikes, station.reliability_label) ?? (
                  <span className="text-gray-400">Brak danych</span>
                )}
              </p>
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeMutation.mutate(station.station_id)
              }}
              disabled={removeMutation.isPending}
              aria-label={`Usuń ${station.name} z ulubionych`}
              className="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors text-sm leading-none p-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
