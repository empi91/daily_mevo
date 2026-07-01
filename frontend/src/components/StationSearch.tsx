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
    <div className="relative max-w-[560px] mx-auto">
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Wpisz nazwę lub adres stacji"
          className="w-full pl-11 pr-4 py-3 border border-border rounded-full bg-surface text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        />
      </div>

      {needsGeocode && loading && (
        <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg px-4 py-3 text-muted">
          Szukam...
        </div>
      )}

      {needsGeocode && error && (
        <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg px-4 py-3 text-red-500">
          {error}
        </div>
      )}

      {!loading && !error && displayResults.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg max-h-80 overflow-y-auto">
          {displayResults.map(r => {
            const s = r.kind === 'nearby' ? r.station : r.station
            return (
              <li key={s.station_id}>
                <Link
                  to={`/stations/${s.station_id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-accent-soft transition-colors border-b border-border last:border-b-0"
                >
                  <div>
                    <span className="font-mono text-sm text-accent">{s.station_id}</span>
                    <span className="mx-2 text-muted">·</span>
                    <span className="text-text">{s.name}</span>
                    {s.address && (
                      <p className="text-sm text-muted mt-0.5">{s.address}</p>
                    )}
                  </div>
                  {r.kind === 'nearby' && (
                    <span className="text-sm text-muted ml-4 whitespace-nowrap">
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
        <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg px-4 py-3 text-muted">
          Brak wyników dla „{query}" — szukam adresu...
        </div>
      )}
    </div>
  )
}
