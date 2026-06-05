import { Link, useParams } from 'react-router-dom'

export default function StationDetailPage() {
  const { stationId } = useParams<{ stationId: string }>()

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link to="/" className="text-blue-600 hover:underline text-sm">
        &larr; Wróć do wyszukiwania
      </Link>
      <h1 className="text-3xl font-bold text-gray-900 mt-4 mb-2">Stacja {stationId}</h1>
      <p className="text-gray-600">Szczegóły stacji — wkrótce w fazie 5</p>
    </div>
  )
}
