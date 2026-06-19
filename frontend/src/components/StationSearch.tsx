import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { geocodeAddress, fetchNearbyStations } from '../api/stations'
import type { StationResponse, NearbyStationResponse } from '../api/stations'

type Result =
  | { kind: 'local'; station: StationResponse }
  | { kind: 'nearby'; station: NearbyStationResponse }

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

const MAX_LOCAL = 10

export default function StationSearch({ stations }: { stations: StationResponse[] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  const localFilter = useCallback(
    (q: string): Result[] => {
      const lower = q.toLowerCase()
      return stations
        .filter(
          s =>
            s.station_id.toLowerCase().includes(lower) ||
            s.name.toLowerCase().includes(lower) ||
            (s.address && s.address.toLowerCase().includes(lower))
        )
        .slice(0, MAX_LOCAL)
        .map(station => ({ kind: 'local' as const, station }))
    },
    [stations]
  )

  const searchAddress = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const geo = await geocodeAddress(q)
      const nearby = await fetchNearbyStations(geo.lat, geo.lon, 5)
      setResults(nearby.map(station => ({ kind: 'nearby' as const, station })))
    } catch {
      setError('Nie znaleziono adresu. Spróbuj wpisać dokładniejszy adres.')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const trimmed = query.trim()
  const localResults = useMemo(() => localFilter(trimmed), [localFilter, trimmed])
  const needsGeocode = trimmed.length >= 3 && localResults.length === 0

  const displayResults = useMemo(() => {
    if (trimmed.length === 0) return []
    if (localResults.length > 0) return localResults
    return results
  }, [trimmed, localResults, results])

  useEffect(() => {
    if (!needsGeocode) return

    debounceRef.current = setTimeout(() => {
      searchAddress(trimmed)
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [needsGeocode, trimmed, searchAddress])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && query.trim().length >= 3) {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const local = localFilter(query.trim())
      if (local.length === 0) {
        searchAddress(query.trim())
      }
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Wpisz numer stacji, nazwę lub adres..."
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 bg-white"
      />

      {needsGeocode && loading && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-gray-500">
          Szukam...
        </div>
      )}

      {needsGeocode && error && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-red-600">
          {error}
        </div>
      )}

      {!loading && !error && displayResults.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {displayResults.map(r => {
            const s = r.kind === 'nearby' ? r.station : r.station
            return (
              <li key={s.station_id}>
                <Link
                  to={`/stations/${s.station_id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                >
                  <div>
                    <span className="font-mono text-sm text-blue-600">{s.station_id}</span>
                    <span className="mx-2 text-gray-400">·</span>
                    <span className="text-gray-900">{s.name}</span>
                    {s.address && (
                      <p className="text-sm text-gray-500 mt-0.5">{s.address}</p>
                    )}
                  </div>
                  {r.kind === 'nearby' && (
                    <span className="text-sm text-gray-400 ml-4 whitespace-nowrap">
                      {formatDistance(r.station.distance_m)}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {needsGeocode && !loading && !error && displayResults.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-gray-500">
          Brak wyników dla „{query}" — szukam adresu...
        </div>
      )}
    </div>
  )
}
