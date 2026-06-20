const BASE_URL = '/api/v1'

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

function extractErrorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'reason' in detail) return String((detail as { reason: string }).reason)
  return ''
}

async function throwApiError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null)
  const message = extractErrorMessage(body?.detail) || `API error: ${response.status}`
  throw new Error(message)
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!response.ok) await throwApiError(response)
  return response.json() as Promise<T>
}

export async function apiPostForm(path: string, data: Record<string, string>): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'include',
    body: new URLSearchParams(data).toString(),
  })
  if (!response.ok) await throwApiError(response)
}

export async function apiPost(path: string): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!response.ok) await throwApiError(response)
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!response.ok) await throwApiError(response)
}
