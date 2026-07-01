import { apiFetch } from './client'
import type { FavouriteStation } from './favourites'

export interface StationResponse {
  station_id: string
  name: string
  address: string | null
  lat: number
  lon: number
  capacity: number | null
}

export interface AvailabilitySlot {
  day_of_week: number
  time_slot: string
  avg_bikes: number
  avg_ebikes: number
  sample_count: number
  reliability_label: string
}

export interface StationDetailResponse {
  station_id: string
  name: string
  address: string | null
  lat: number
  lon: number
  capacity: number | null
  availability: AvailabilitySlot[]
}

export interface NearbyStationResponse {
  station_id: string
  name: string
  address: string | null
  lat: number
  lon: number
  capacity: number | null
  distance_m: number
}

export interface GeocodeResponse {
  lat: number
  lon: number
  display_name: string
}

export function fetchPopularStations(): Promise<FavouriteStation[]> {
  return apiFetch<FavouriteStation[]>('/stations/popular')
}

export function fetchStations(): Promise<StationResponse[]> {
  return apiFetch<StationResponse[]>('/stations')
}

export function fetchStationDetail(stationId: string): Promise<StationDetailResponse> {
  return apiFetch<StationDetailResponse>(`/stations/${encodeURIComponent(stationId)}`)
}

export function geocodeAddress(query: string): Promise<GeocodeResponse> {
  return apiFetch<GeocodeResponse>(`/geocode?q=${encodeURIComponent(query)}`)
}

export function fetchNearbyStations(lat: number, lon: number, limit = 5): Promise<NearbyStationResponse[]> {
  return apiFetch<NearbyStationResponse[]>(`/stations/nearby?lat=${lat}&lon=${lon}&limit=${limit}`)
}
