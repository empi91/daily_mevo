import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import StationDetailPage from './pages/StationDetailPage'

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/stations/:stationId" element={<StationDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
