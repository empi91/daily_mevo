import { apiFetch, apiPostJson, apiPostForm, apiPost } from './client'

export interface User {
  id: string
  email: string
  is_active: boolean
  is_superuser: boolean
  is_verified: boolean
}

export function register(email: string, password: string): Promise<User> {
  return apiPostJson<User>('/auth/register', { email, password })
}

export function login(email: string, password: string): Promise<void> {
  return apiPostForm('/auth/cookie/login', { username: email, password })
}

export function logout(): Promise<void> {
  return apiPost('/auth/cookie/logout')
}

export function fetchCurrentUser(): Promise<User> {
  return apiFetch<User>('/users/me')
}
