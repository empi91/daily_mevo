import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchCurrentUser, login, register, logout, type User } from '../api/auth'

const ME_QUERY_KEY = ['auth', 'me']

export function useAuth() {
  const queryClient = useQueryClient()

  const { data: user = null, isLoading } = useQuery<User | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => fetchCurrentUser().catch(() => null),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  })

  const registerMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      register(email, password),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
  })

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => queryClient.setQueryData(ME_QUERY_KEY, null),
  })

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
    loginMutation,
    registerMutation,
    logoutMutation,
  }
}
