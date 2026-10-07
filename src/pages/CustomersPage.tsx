import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CustomerDetail } from '@shared/customers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { CustomerDetailDialog } from '@/modules/customers/CustomerDetailDialog'
import { CustomerFormDialog } from '@/modules/customers/CustomerFormDialog'
import { CUSTOMER_KEYS } from '@/modules/customers/hooks'
import { useDebouncedValue } from '@/modules/menu/hooks'
import { customerService } from '@/services/customers.service'
import { usePermission } from '@/stores/auth.store'

type FormTarget = 'closed' | 'new' | CustomerDetail

/** Admin: the customer list. Customers are also created automatically from orders and bookings. */
export function CustomersPage() {
  const canManage = usePermission('customers.manage')
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const [params] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(params.get('customer'))
  const [form, setForm] = useState<FormTarget>('closed')

  const filter = { ...(debounced ? { search: debounced } : {}), limit: 300 }
  const customers = useQuery({
    queryKey: CUSTOMER_KEYS.list(filter),
    queryFn: () => customerService.list(filter),
    staleTime: 0
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Customers</h2>
          <p className="text-sm text-muted-foreground">
            People who order or book with you. They are matched by phone number, and added
            automatically the first time a phone number is used on an order or a reservation.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setForm('new')
            }}
          >
            <Plus /> Add customer
          </Button>
        )}
      </div>

      <label className="block space-y-1 text-xs font-medium">
        Search
        <Input
          className="w-72"
          placeholder="Name or phone number"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
        />
      </label>

      {customers.isPending && <Skeleton className="h-64 w-full" />}
      {customers.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(customers.error)}
        </p>
      )}
      {customers.isSuccess && customers.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {debounced
            ? 'No customer matches this search.'
            : 'No customers yet. They appear here once an order or booking has a phone number.'}
        </div>
      )}
      {customers.isSuccess && customers.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="customers-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2 text-right">Orders</th>
                <th className="px-3 py-2 text-right">Spent</th>
                <th className="px-3 py-2">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {customers.data.map((customer) => (
                <tr key={customer.id} className="hover:bg-accent/50">
                  <td className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      className="text-left text-primary hover:underline"
                      onClick={() => {
                        setOpenId(customer.id)
                      }}
                    >
                      {customer.name}
                    </button>
                  </td>
                  <td className="px-3 py-2">{customer.phone}</td>
                  <td className="px-3 py-2 text-right">{customer.orderCount}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(customer.totalSpent)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CustomerDetailDialog
        customerId={openId}
        onClose={() => {
          setOpenId(null)
        }}
        onEdit={(customer) => {
          setForm(customer)
        }}
      />
      <CustomerFormDialog
        open={form !== 'closed'}
        customer={form === 'closed' || form === 'new' ? null : form}
        onClose={() => {
          setForm('closed')
        }}
        onSaved={(saved) => {
          setForm('closed')
          setOpenId(saved.id)
        }}
      />
    </div>
  )
}
