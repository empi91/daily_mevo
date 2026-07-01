import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { loginMutation, registerMutation } = useAuth()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setValidationError(null)

    if (password.length < 8) {
      setValidationError('Hasło musi mieć co najmniej 8 znaków')
      return
    }

    registerMutation.mutate(
      { email, password },
      {
        onSuccess: () => {
          loginMutation.mutate(
            { email, password },
            { onSuccess: () => navigate('/') },
          )
        },
      },
    )
  }

  function translateRegisterError(msg: string): string {
    if (msg.includes('REGISTER_USER_ALREADY_EXISTS')) return 'Ten adres email jest już zarejestrowany'
    return msg
  }

  const errorMessage = validationError
    ?? (registerMutation.isError ? translateRegisterError(registerMutation.error.message) : null)
    ?? (loginMutation.isError ? loginMutation.error.message : null)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-text mb-6">Zarejestruj się</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-muted mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-muted mb-1">
            Hasło
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-md text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          />
          <p className="mt-1 text-xs text-muted">Minimum 8 znaków</p>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}

        <button
          type="submit"
          disabled={registerMutation.isPending || loginMutation.isPending}
          className="w-full py-2 px-4 bg-accent text-accent-text font-medium rounded-md hover:opacity-90 disabled:opacity-50 transition-colors"
        >
          {registerMutation.isPending || loginMutation.isPending ? 'Rejestracja...' : 'Zarejestruj się'}
        </button>
      </form>

      <p className="mt-4 text-sm text-muted">
        Masz już konto?{' '}
        <Link to="/login" className="text-accent hover:underline">
          Zaloguj się
        </Link>
      </p>
    </div>
  )
}
