import { useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { ThemeContext, STORAGE_KEY, getSystemTheme, resolveTheme, type Theme } from './useTheme'

let currentTheme: Theme = (() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* SSR / test env */ }
  return 'system'
})()

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  return currentTheme
}

function setThemeExternal(next: Theme) {
  currentTheme = next
  if (next === 'system') {
    localStorage.removeItem(STORAGE_KEY)
  } else {
    localStorage.setItem(STORAGE_KEY, next)
  }
  listeners.forEach(l => l())
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot)
  const resolved = resolveTheme(theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const r = getSystemTheme()
      document.documentElement.classList.toggle('dark', r === 'dark')
      listeners.forEach(l => l())
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeExternal(next), [])

  const value = useMemo(() => ({
    theme,
    resolvedTheme: resolved,
    setTheme,
  }), [theme, resolved, setTheme])

  return (
    <ThemeContext value={value}>
      {children}
    </ThemeContext>
  )
}
