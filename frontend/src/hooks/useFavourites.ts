import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchFavourites, addFavourite, removeFavourite, type FavouriteStation } from '../api/favourites'
import { useAuth } from './useAuth'

const FAVOURITES_KEY = ['favourites']

export function useFavourites() {
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  const { data: favourites = [], isLoading } = useQuery<FavouriteStation[]>({
    queryKey: FAVOURITES_KEY,
    queryFn: fetchFavourites,
    enabled: isAuthenticated,
  })

  const addMutation = useMutation({
    mutationFn: addFavourite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY }),
  })

  const removeMutation = useMutation({
    mutationFn: removeFavourite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FAVOURITES_KEY }),
  })

  function isFavourite(stationId: string): boolean {
    return favourites.some((f) => f.station_id === stationId)
  }

  return { favourites, isLoading, addMutation, removeMutation, isFavourite }
}
