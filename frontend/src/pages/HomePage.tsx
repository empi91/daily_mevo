import { useQuery } from '@tanstack/react-query'
import { fetchStations } from '../api/stations'
import StationSearch from '../components/StationSearch'
import PopularStations from '../components/PopularStations'
import FavouriteStations from '../components/FavouriteStations'
import { useAuth } from '../hooks/useAuth'
import { useFavourites } from '../hooks/useFavourites'

export default function HomePage() {
  const { data: stations = [] } = useQuery({
    queryKey: ['stations'],
    queryFn: fetchStations,
  })
  const { isAuthenticated } = useAuth()
  const { favourites } = useFavourites()

  const showFavourites = isAuthenticated && favourites.length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">MevoStats</h1>
        <p className="text-lg text-gray-600">
          Sprawdź historyczną dostępność rowerów na stacjach Mevo w Trójmieście
        </p>
      </div>

      <div className="mb-10">
        <StationSearch stations={stations} />
      </div>

      {showFavourites ? <FavouriteStations /> : <PopularStations />}
    </div>
  )
}
