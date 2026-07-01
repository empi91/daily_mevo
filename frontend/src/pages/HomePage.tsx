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
    <div className="max-w-[920px] mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-full bg-accent flex items-center justify-center">
            <span className="text-accent-text font-extrabold text-lg">M</span>
          </div>
          <h1 className="text-[38px] font-extrabold text-text">MevoStats</h1>
        </div>
        <p className="text-lg text-muted max-w-[440px] mx-auto">
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
