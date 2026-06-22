import { Link } from 'react-router-dom'
import { useFavourites } from '../hooks/useFavourites'
import { plainBikesLabel, ebikesLabel } from '../polish'

export default function FavouriteStations() {
  const { favourites, removeMutation } = useFavourites()

  if (favourites.length === 0) return null

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Twoje ulubione stacje</h2>
      {removeMutation.isError && (
        <p className="text-sm text-red-500 mb-2">Nie udało się usunąć stacji. Spróbuj ponownie.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {favourites.map((station) => (
          <div key={station.station_id} className="relative">
            <Link
              to={`/stations/${station.station_id}`}
              className="flex flex-col h-full p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <span className="font-mono text-sm text-blue-600">{station.name}</span>
              {station.address && <p className="text-sm text-gray-500 mt-1">{station.address}</p>}
              {station.avg_bikes === null || station.avg_ebikes === null ? (
                <p className="text-sm text-gray-400 mt-2">Brak danych</p>
              ) : (
                <div className="mt-2 text-sm text-gray-700">
                  <p>Statystycznie o tej godzinie:</p>
                  {(() => {
                    const bikes = Math.round(station.avg_bikes)
                    const ebikes = Math.round(station.avg_ebikes)
                    if (ebikes === 0 && bikes === 0) {
                      return <p className="text-gray-400">Brak rowerów</p>
                    }
                    return (
                      <>
                        {ebikes > 0 && <p>{ebikes} {ebikesLabel(ebikes)}</p>}
                        {bikes > 0 && <p>{bikes} {plainBikesLabel(bikes)}</p>}
                      </>
                    )
                  })()}
                </div>
              )}
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeMutation.mutate(station.station_id)
              }}
              disabled={removeMutation.isPending && removeMutation.variables === station.station_id}
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
