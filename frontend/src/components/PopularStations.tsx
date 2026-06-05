import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchStations } from '../api/stations'

const FEATURED_IDS = ['4076', '3839', '4192', '4345', '4353', '3829']

export default function PopularStations() {
  const { data: stations = [] } = useQuery({
    queryKey: ['stations'],
    queryFn: fetchStations,
  })

  const featured = stations.filter(s => FEATURED_IDS.includes(s.station_id))

  if (featured.length === 0) return null

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Popularne stacje</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {featured.map(station => (
          <Link
            key={station.station_id}
            to={`/stations/${station.station_id}`}
            className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <span className="font-mono text-sm text-blue-600">{station.name}</span>
            <p className="text-sm text-gray-500 mt-1">{station.address}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
