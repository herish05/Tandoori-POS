import { ChevronDown, KeyRound, LogOut, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useSignOut } from '@/modules/auth/use-sign-out'
import { useAuthStore } from '@/stores/auth.store'

/** Who is signed in, with change-password and sign-out. */
export function UserMenu({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const session = useAuthStore((s) => s.session)
  const signOut = useSignOut()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!session) return null
  const roleNames = session.user.roles.map((role) => role.name).join(', ')

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold',
          tone === 'dark' ? 'bg-white/10 hover:bg-white/20' : 'bg-secondary hover:bg-secondary/80'
        )}
      >
        <User className="size-4" aria-hidden />
        <span className="flex flex-col items-start leading-tight">
          <span>{session.user.fullName}</span>
          <span className="text-[10px] font-medium opacity-70">{roleNames}</span>
        </span>
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border bg-card py-1 text-card-foreground shadow-lg"
        >
          <Link
            role="menuitem"
            to="/account"
            onClick={() => {
              setOpen(false)
            }}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
          >
            <KeyRound className="size-4" aria-hidden />
            Account and password
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              signOut.mutate()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
