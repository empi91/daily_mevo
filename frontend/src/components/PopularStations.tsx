import { useQuery } from '@tanstack/react-query'
import { fetchPopularStations } from '../api/stations'
import StationCard from './StationCard'

export default function PopularStations() {
  const { data: stations = [] } = useQuery({
    queryKey: ['popularStations'],
    queryFn: fetchPopularStations,
  })

  if (stations.length === 0) return null

  return (
    <section>
      <h2 className="text-base font-extrabold text-text mb-3">Popularne stacje</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {stations.map(station => (
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
