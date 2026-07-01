import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import ThemeToggle from './ThemeToggle'

export default function Layout() {
  const { user, isAuthenticated, logoutMutation } = useAuth()

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <header className="bg-surface border-b border-border">
        <div className="max-w-[920px] mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold text-text hover:text-accent transition-colors">
            MevoStats
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted hidden sm:inline">Dostępność rowerów w Trójmieście</span>
            <ThemeToggle />
            {isAuthenticated ? (
              <>
                <span className="text-sm text-muted">{user?.email}</span>
                <button
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="text-sm text-muted hover:text-text transition-colors cursor-pointer"
                >
                  Wyloguj
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sm text-accent hover:underline">
                  Zaloguj się
                </Link>
                <Link to="/register" className="text-sm text-accent hover:underline">
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

      <footer className="bg-surface border-t border-border mt-auto">
        <div className="max-w-[920px] mx-auto px-4 py-4 text-center text-sm text-muted">
          Dane z Mevo Open Data API (GBFS)
        </div>
      </footer>
    </div>
  )
}
