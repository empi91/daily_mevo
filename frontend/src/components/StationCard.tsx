import { Link } from 'react-router-dom'
import { plainBikesLabel, ebikesLabel } from '../polish'
import FavouriteToggleButton from './FavouriteToggleButton'

interface StationCardProps {
  station: {
    station_id: string
    name: string
    address: string | null
    avg_bikes: number | null
    avg_ebikes: number | null
  }
  showHeart: boolean
}

export default function StationCard({ station, showHeart }: StationCardProps) {
  const bikes = station.avg_bikes !== null ? Math.round(station.avg_bikes) : null
  const ebikes = station.avg_ebikes !== null ? Math.round(station.avg_ebikes) : null
  const hasData = bikes !== null && ebikes !== null
  const bothZero = hasData && bikes === 0 && ebikes === 0

  return (
    <div className="relative h-[138px] bg-surface border border-border rounded-[14px] overflow-hidden">
      <Link
        to={`/stations/${station.station_id}`}
        className="flex flex-col h-full px-4 py-3"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-medium text-accent">
            {station.name}
          </span>
          {showHeart && (
            <span onClick={e => e.preventDefault()}>
              <FavouriteToggleButton stationId={station.station_id} stationName={station.name} />
            </span>
          )}
        </div>

        {station.address && (
          <p className="text-sm font-bold text-text mt-0.5">{station.address}</p>
        )}

        <div className="mt-auto">
          {!hasData ? (
            <p className="text-sm font-bold text-muted">Brak danych</p>
          ) : bothZero ? (
            <p className="text-sm font-bold text-muted">Brak rowerów</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-muted mb-0.5">
                Statystycznie o tej godzinie:
              </p>
              {ebikes! > 0 && (
                <p className="text-[13.5px] font-extrabold text-text">
                  <span>{ebikes}</span>{' '}
                  <span className="font-bold">{ebikesLabel(ebikes!)}</span>
                </p>
              )}
              {bikes! > 0 && (
                <p className="text-[13.5px] font-extrabold text-text">
                  <span>{bikes}</span>{' '}
                  <span className="font-bold">{plainBikesLabel(bikes!)}</span>
                </p>
              )}
            </>
          )}
        </div>
      </Link>
    </div>
  )
}
