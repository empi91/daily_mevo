import { apiFetch, apiPost, apiDelete } from './client'

export interface FavouriteStation {
  station_id: string
  name: string
  address: string | null
  lat: number
  lon: number
  capacity: number | null
  avg_bikes: number | null
  avg_ebikes: number | null
  reliability_label: string | null
}

export function fetchFavourites(): Promise<FavouriteStation[]> {
  return apiFetch<FavouriteStation[]>('/favourites')
}

export function addFavourite(stationId: string): Promise<void> {
  return apiPost(`/favourites/${encodeURIComponent(stationId)}`)
}

export function removeFavourite(stationId: string): Promise<void> {
  return apiDelete(`/favourites/${encodeURIComponent(stationId)}`)
}
