import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Layout() {
  const { user, isAuthenticated, logoutMutation } = useAuth()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-gray-900 hover:text-blue-600 transition-colors">
            MevoStats
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">Dostępność rowerów w Trójmieście</span>
            {isAuthenticated ? (
              <>
                <span className="text-sm text-gray-700">{user?.email}</span>
                <button
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Wyloguj
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sm text-blue-600 hover:underline">
                  Zaloguj się
                </Link>
                <Link to="/register" className="text-sm text-blue-600 hover:underline">
                  Zarejestruj się
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          Dane z Mevo Open Data API (GBFS)
        </div>
      </footer>
    </div>
  )
}
