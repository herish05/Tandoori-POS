import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'

export function useSignOut() {
  const navigate = useNavigate()
  const clear = useAuthStore((s) => s.clear)
  return useMutation({
    mutationFn: authService.logout,
    onSettled: () => {
      clear()
      void navigate('/login', { replace: true })
    }
  })
}
