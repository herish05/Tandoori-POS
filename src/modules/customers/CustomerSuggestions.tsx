import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { useState } from 'react'
import type { CustomerLookupResult } from '@shared/customers'
import { formatDateTime } from '@/lib/format'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { customerService } from '@/services/customers.service'
import { usePermission } from '@/stores/auth.store'
import { CUSTOMER_KEYS } from './hooks'

interface CustomerSuggestionsProps {
  /** What was typed in the name or phone field. */
  query: string
  onPick: (customer: CustomerLookupResult) => void
  disabled?: boolean | undefined
}

/**
 * Known customers matching what is being typed. Picking one fills in their details. Shown only
 * to staff who may take orders, since it reads the customer list.
 */
export function CustomerSuggestions({ query, onPick, disabled }: CustomerSuggestionsProps) {
  const allowed = usePermission('orders.operate')
  const [picked, setPicked] = useState<string[]>([])
  const typed = useDebouncedValue(query.trim())
  const enabled = allowed && !disabled && typed.length >= 2 && !picked.includes(typed)

  const found = useQuery({
    queryKey: CUSTOMER_KEYS.lookup(typed),
    queryFn: () => customerService.lookup({ query: typed }),
    enabled,
    staleTime: 10_000
  })

  if (!enabled || !found.data || found.data.length === 0) return null

  return (
    <ul
      aria-label="Matching customers"
      className="divide-y overflow-hidden rounded-md border bg-card text-sm shadow-sm"
    >
      {found.data.map((customer) => (
        <li key={customer.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent touch:py-3"
            onClick={() => {
              setPicked([typed, customer.name, customer.phone])
              onPick(customer)
            }}
          >
            <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{customer.name}</span>
              <span className="block text-xs text-muted-foreground">
                {customer.phone}
                {customer.orderCount > 0 &&
                  ` · ${String(customer.orderCount)} orders${customer.lastOrderAt ? `, last ${formatDateTime(customer.lastOrderAt)}` : ''}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
