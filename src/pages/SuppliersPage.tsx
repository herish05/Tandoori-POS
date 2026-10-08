import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toUserMessage } from '@/lib/ipc'
import { formatMoney } from '@/lib/money'
import { useDebouncedValue } from '@/modules/menu/hooks'
import {
  PURCHASING_KEYS,
  formatPurchaseDate,
  useRefreshPurchasing
} from '@/modules/purchasing/hooks'
import { SupplierFormDialog } from '@/modules/purchasing/SupplierFormDialog'
import { supplierService } from '@/services/purchasing.service'
import { usePermission } from '@/stores/auth.store'
import type { Supplier } from '@shared/purchasing'

/** Admin: the people the restaurant buys from, and what is owed to each. */
export function SuppliersPage() {
  const canManage = usePermission('suppliers.manage')
  const refresh = useRefreshPurchasing()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const [dueOnly, setDueOnly] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [form, setForm] = useState<'closed' | 'new' | Supplier>('closed')
  const [removing, setRemoving] = useState<Supplier | null>(null)

  const filter = {
    ...(debounced ? { search: debounced } : {}),
    ...(dueOnly ? { dueOnly: true } : {}),
    ...(includeInactive ? { includeInactive: true } : {})
  }
  const suppliers = useQuery({
    queryKey: PURCHASING_KEYS.suppliers(filter),
    queryFn: () => supplierService.list(filter),
    staleTime: 0
  })
  const toggle = useMutation({ mutationFn: supplierService.setActive, onSuccess: refresh })
  const remove = useMutation({
    mutationFn: supplierService.remove,
    onSuccess: async () => {
      await refresh()
      setRemoving(null)
    }
  })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Suppliers</h2>
        <p className="text-sm text-muted-foreground">
          Who you buy raw materials from, their contact details and what is still owed to them.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block space-y-1 text-xs font-medium">
            Search
            <Input
              className="w-64"
              placeholder="Name, contact or phone"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
              }}
            />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(event) => {
                setDueOnly(event.target.checked)
              }}
            />
            Owed money only
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => {
                setIncludeInactive(event.target.checked)
              }}
            />
            Show deactivated
          </label>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setForm('new')
            }}
          >
            <Plus /> Add supplier
          </Button>
        )}
      </div>

      {suppliers.isPending && <Skeleton className="h-64 w-full" />}
      {suppliers.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(suppliers.error)}
        </p>
      )}
      {toggle.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(toggle.error)}
        </p>
      )}
      {suppliers.isSuccess && suppliers.data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {debounced || dueOnly
            ? 'No supplier matches.'
            : 'No suppliers yet. Add the people you buy from.'}
        </div>
      )}
      {suppliers.isSuccess && suppliers.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm" data-testid="suppliers-table">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2 text-right">Purchases</th>
                <th className="px-3 py-2 text-right">Bought</th>
                <th className="px-3 py-2 text-right">Owed</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {suppliers.data.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-accent/50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{supplier.name}</div>
                    {supplier.gstin && (
                      <div className="text-xs text-muted-foreground">GSTIN {supplier.gstin}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div>{supplier.contactPerson ?? ''}</div>
                    <div>{supplier.phone ?? ''}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div>{supplier.purchaseCount}</div>
                    {supplier.lastPurchaseDate && (
                      <div className="text-xs text-muted-foreground">
                        Last {formatPurchaseDate(supplier.lastPurchaseDate)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{formatMoney(supplier.totalPurchased)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${supplier.amountDue > 0 ? 'text-warning' : ''}`}
                  >
                    {supplier.amountDue > 0 ? formatMoney(supplier.amountDue) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {supplier.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canManage && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setForm(supplier)
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={toggle.isPending}
                          onClick={() => {
                            toggle.mutate({ id: supplier.id, isActive: !supplier.isActive })
                          }}
                        >
                          {supplier.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            remove.reset()
                            setRemoving(supplier)
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SupplierFormDialog
        open={form !== 'closed'}
        supplier={form === 'closed' || form === 'new' ? null : form}
        onClose={() => {
          setForm('closed')
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title="Delete supplier"
        message={`Delete ${removing?.name ?? 'this supplier'}? A supplier with any purchase on record cannot be deleted; deactivate it instead.`}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        error={remove.isError ? toUserMessage(remove.error) : undefined}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
        }}
        onClose={() => {
          setRemoving(null)
        }}
      />
    </div>
  )
}
