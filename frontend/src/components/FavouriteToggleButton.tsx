import { useAuth } from '../hooks/useAuth'
import { useFavourites } from '../hooks/useFavourites'

interface Props {
  stationId: string
}

export default function FavouriteToggleButton({ stationId }: Props) {
  const { isAuthenticated } = useAuth()
  const { isFavourite, addMutation, removeMutation } = useFavourites()

  if (!isAuthenticated) return null

  const favourited = isFavourite(stationId)
  const pending = addMutation.isPending || removeMutation.isPending
  const error = addMutation.isError || removeMutation.isError

  function handleClick() {
    if (favourited) {
      removeMutation.mutate(stationId)
    } else {
      addMutation.mutate(stationId)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={favourited ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
        className={`text-2xl transition-colors ${pending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${favourited ? 'text-red-500 hover:text-red-600' : 'text-gray-400 hover:text-red-400'}`}
      >
        {favourited ? '♥' : '♡'}
      </button>
      {error && <span className="text-xs text-red-500">Błąd</span>}
    </div>
  )
}
