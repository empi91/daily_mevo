import { BrowserRouter, Routes, Route } from 'react-router-dom'

function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">MevoStats</h1>
      <p className="text-lg text-gray-600 mb-8">
        Historical bike availability patterns for Mevo stations
      </p>
      <a href="/stations/test" className="text-blue-600 hover:underline">
        View test station &rarr;
      </a>
    </div>
  )
}

function StationDetailPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Station Detail</h1>
      <p className="text-gray-600 mb-8">Station detail page placeholder</p>
      <a href="/" className="text-blue-600 hover:underline">
        &larr; Back to home
      </a>
    </div>
  )
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/stations/:stationId" element={<StationDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}
