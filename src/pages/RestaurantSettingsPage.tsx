import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { restaurantInputSchema } from '@shared/auth-schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import {
  toFormValues,
  toRestaurantInput,
  type RestaurantFormValues
} from '@/modules/restaurant/restaurant-form'
import { RestaurantFields } from '@/modules/restaurant/RestaurantFields'
import { restaurantService } from '@/services/auth.service'
import { usePermission } from '@/stores/auth.store'

const RESTAURANT_KEY = ['restaurant'] as const

function RestaurantForm({
  initial,
  canManage
}: {
  initial: RestaurantFormValues
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<RestaurantFormValues>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: (input: RestaurantFormValues) => restaurantService.update(toRestaurantInput(input)),
    onSuccess: async (next) => {
      queryClient.setQueryData(RESTAURANT_KEY, next)
      await queryClient.invalidateQueries({ queryKey: ['system', 'setup-status'] })
      setValues(toFormValues(next))
      setSaved(true)
    }
  })

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault()
    setSaved(false)
    const result = restaurantInputSchema.safeParse(toRestaurantInput(values))
    if (!result.success) {
      setErrors(fieldErrors(result.error))
      return
    }
    setErrors({})
    save.mutate(values)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <RestaurantFields
        values={values}
        errors={errors}
        disabled={!canManage}
        onChange={(patch) => {
          setSaved(false)
          setValues((current) => ({ ...current, ...patch }))
        }}
      />
      {save.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {toUserMessage(save.error)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm font-medium text-success">
          Settings saved.
        </p>
      )}
      {canManage && (
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      )}
    </form>
  )
}

export function RestaurantSettingsPage() {
  const canManage = usePermission('restaurant.manage')
  const profile = useQuery({ queryKey: RESTAURANT_KEY, queryFn: restaurantService.get })

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-bold">Restaurant settings</h2>
        <p className="text-sm text-muted-foreground">These details appear on bills and receipts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            {canManage
              ? 'Changes apply to new bills straight away.'
              : 'You can view but not change these.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profile.isPending && <Skeleton className="h-64" />}
          {profile.isError && (
            <p role="alert" className="text-sm text-destructive">
              {toUserMessage(profile.error)}
            </p>
          )}
          {profile.data && (
            <RestaurantForm initial={toFormValues(profile.data)} canManage={canManage} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
