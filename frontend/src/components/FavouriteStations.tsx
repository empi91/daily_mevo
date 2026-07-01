import { useFavourites } from '../hooks/useFavourites'
import StationCard from './StationCard'

export default function FavouriteStations() {
  const { favourites, removeMutation } = useFavourites()

  if (favourites.length === 0) return null

  return (
    <section>
      <h2 className="text-base font-extrabold text-text mb-3">Twoje ulubione stacje</h2>
      {removeMutation.isError && (
        <p className="text-sm text-red-500 mb-2">Nie udało się usunąć stacji. Spróbuj ponownie.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {favourites.map(station => (
          <StationCard
            key={station.station_id}
            station={station}
            showHeart={true}
          />
        ))}
      </div>
    </section>
  )
}
