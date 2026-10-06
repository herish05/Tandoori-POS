import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  adminSidebarCollapsed: boolean
  toggleAdminSidebar: () => void
}

/** Purely visual preferences, persisted per machine in localStorage. Never holds business data. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      adminSidebarCollapsed: false,
      toggleAdminSidebar: () => {
        set((s) => ({ adminSidebarCollapsed: !s.adminSidebarCollapsed }))
      }
    }),
    { name: 'tandoori-pos.ui' }
  )
)
