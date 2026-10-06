import { useQuery } from '@tanstack/react-query'
import { systemService } from '@/services/system.service'

export const systemKeys = {
  appInfo: ['system', 'app-info'] as const,
  health: ['system', 'health'] as const,
  userConfig: ['system', 'user-config'] as const
}

export function useAppInfo() {
  return useQuery({
    queryKey: systemKeys.appInfo,
    queryFn: systemService.getAppInfo,
    staleTime: Infinity
  })
}

export function useHealth() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: systemService.checkHealth,
    staleTime: 0
  })
}
