import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { passwordSchema, restaurantInputSchema, setupInputSchema } from '@shared/auth-schemas'
import { BrandLogo } from '@/components/BrandLogo'
import { ConnectivityIndicator } from '@/components/ConnectivityIndicator'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { WindowControls } from '@/components/WindowControls'
import { fieldErrors } from '@/lib/form'
import { toUserMessage } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import {
  EMPTY_RESTAURANT,
  toRestaurantInput,
  type RestaurantFormValues
} from '@/modules/restaurant/restaurant-form'
import { RestaurantFields } from '@/modules/restaurant/RestaurantFields'
import { authService } from '@/services/auth.service'

interface OwnerValues {
  username: string
  fullName: string
  email: string
  phone: string
  password: string
  confirmPassword: string
}

const EMPTY_OWNER: OwnerValues = {
  username: '',
  fullName: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: ''
}

const STEPS = ['Restaurant', 'Owner account', 'Password', 'Confirm'] as const
const OWNER_DETAIL_KEYS = ['username', 'fullName', 'email', 'phone']

/**
 * First-run wizard: restaurant information, owner account, password, confirmation. Nothing is
 * written until the last step, and then everything is written in one transaction.
 */
export function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [restaurant, setRestaurant] = useState<RestaurantFormValues>(EMPTY_RESTAURANT)
  const [owner, setOwner] = useState<OwnerValues>(EMPTY_OWNER)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const complete = useMutation({
    mutationFn: authService.completeSetup,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['system', 'setup-status'] })
      void navigate('/login', { replace: true, state: { justSetup: true } })
    }
  })

  const validateStep = (index: number): Record<string, string> => {
    if (index === 0) {
      const result = restaurantInputSchema.safeParse(toRestaurantInput(restaurant))
      return result.success ? {} : fieldErrors(result.error)
    }
    const result = setupInputSchema.shape.owner.safeParse(owner)
    const all = result.success ? {} : fieldErrors(result.error)
    if (index === 1) {
      return Object.fromEntries(
        Object.entries(all).filter(([key]) => OWNER_DETAIL_KEYS.includes(key))
      )
    }
    // Password step: checked directly so the match message always appears.
    const found: Record<string, string> = {}
    const password = passwordSchema.safeParse(owner.password)
    if (!password.success) found.password = password.error.issues[0]?.message ?? 'Invalid password.'
    else if (all.password) found.password = all.password
    if (owner.confirmPassword !== owner.password) found.confirmPassword = 'Passwords do not match.'
    return found
  }

  const next = (event?: SyntheticEvent): void => {
    event?.preventDefault()
    if (step === STEPS.length - 1) {
      finish()
      return
    }
    const found = validateStep(step)
    setErrors(found)
    if (Object.keys(found).length === 0) setStep((value) => Math.min(value + 1, STEPS.length - 1))
  }

  const finish = (): void => {
    for (const index of [0, 1, 2]) {
      const found = validateStep(index)
      if (Object.keys(found).length > 0) {
        setErrors(found)
        setStep(index)
        return
      }
    }
    complete.mutate({ restaurant: toRestaurantInput(restaurant), owner })
  }

  const updateRestaurant = (patch: Partial<RestaurantFormValues>): void => {
    setRestaurant((value) => ({ ...value, ...patch }))
  }
  const updateOwner = (patch: Partial<OwnerValues>): void => {
    setOwner((value) => ({ ...value, ...patch }))
  }
  const ownerText =
    (key: keyof OwnerValues) =>
    (event: { target: { value: string } }): void => {
      updateOwner({ [key]: event.target.value })
    }

  return (
    <div className="flex h-full flex-col bg-navy text-navy-foreground">
      <div className="flex items-center justify-between gap-2 p-3">
        <BrandLogo tone="light" />
        <div className="flex items-center gap-2">
          <ConnectivityIndicator />
          <WindowControls tone="dark" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-xl">Welcome to Tandoori-POS</CardTitle>
            <CardDescription>
              Let’s set up your restaurant. This only happens once on this computer.
            </CardDescription>
            <ol className="mt-3 flex flex-wrap gap-2" aria-label="Setup progress">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
                    index === step
                      ? 'bg-primary text-primary-foreground'
                      : index < step
                        ? 'bg-success/15 text-success'
                        : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {index < step ? (
                    <Check className="size-3" aria-hidden />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                  {label}
                </li>
              ))}
            </ol>
          </CardHeader>

          <CardContent>
            <form onSubmit={next} noValidate className="space-y-5">
              {step === 0 && (
                <RestaurantFields values={restaurant} errors={errors} onChange={updateRestaurant} />
              )}

              {step === 1 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <p className="text-sm text-muted-foreground sm:col-span-2">
                    The owner has full access and can add other staff later.
                  </p>
                  <Field
                    label="Full name"
                    required
                    error={errors.fullName}
                    className="sm:col-span-2"
                  >
                    {(c) => (
                      <Input
                        {...c}
                        autoComplete="name"
                        value={owner.fullName}
                        onChange={ownerText('fullName')}
                      />
                    )}
                  </Field>
                  <Field
                    label="Username"
                    required
                    error={errors.username}
                    hint="Letters, numbers, dot, dash or underscore. Used to sign in."
                  >
                    {(c) => (
                      <Input
                        {...c}
                        autoComplete="username"
                        value={owner.username}
                        onChange={ownerText('username')}
                      />
                    )}
                  </Field>
                  <div />
                  <Field label="Email" error={errors.email}>
                    {(c) => (
                      <Input
                        {...c}
                        type="email"
                        value={owner.email}
                        onChange={ownerText('email')}
                      />
                    )}
                  </Field>
                  <Field label="Phone" error={errors.phone}>
                    {(c) => (
                      <Input {...c} type="tel" value={owner.phone} onChange={ownerText('phone')} />
                    )}
                  </Field>
                </div>
              )}

              {step === 2 && (
                <div className="grid max-w-md gap-4">
                  <p className="text-sm text-muted-foreground">
                    Choose a strong password: at least 8 characters with a letter and a number.
                    Passwords are never stored in readable form and cannot be recovered, so keep it
                    safe.
                  </p>
                  <Field label="Password" required error={errors.password}>
                    {(c) => (
                      <Input
                        {...c}
                        type="password"
                        autoComplete="new-password"
                        value={owner.password}
                        onChange={ownerText('password')}
                      />
                    )}
                  </Field>
                  <Field label="Confirm password" required error={errors.confirmPassword}>
                    {(c) => (
                      <Input
                        {...c}
                        type="password"
                        autoComplete="new-password"
                        value={owner.confirmPassword}
                        onChange={ownerText('confirmPassword')}
                      />
                    )}
                  </Field>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Check these details. Creating the restaurant sets up the local database and the
                    owner account.
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md border p-4 text-sm">
                    <dt className="text-muted-foreground">Restaurant</dt>
                    <dd className="font-medium">{restaurant.name}</dd>
                    <dt className="text-muted-foreground">Address</dt>
                    <dd className="font-medium">
                      {restaurant.address}, {restaurant.city}, {restaurant.state},{' '}
                      {restaurant.country}
                    </dd>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd className="font-medium">{restaurant.phone}</dd>
                    <dt className="text-muted-foreground">GSTIN</dt>
                    <dd className="font-medium">{restaurant.gstin || 'Not provided'}</dd>
                    <dt className="text-muted-foreground">Currency and time zone</dt>
                    <dd className="font-medium">INR (₹) · Asia/Kolkata</dd>
                    <dt className="text-muted-foreground">Owner</dt>
                    <dd className="font-medium">
                      {owner.fullName} ({owner.username.trim().toLowerCase()})
                    </dd>
                  </dl>
                  {complete.isError && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {toUserMessage(complete.error)}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-between border-t pt-4">
                <Button
                  variant="outline"
                  disabled={step === 0 || complete.isPending}
                  onClick={() => {
                    setErrors({})
                    setStep((value) => Math.max(value - 1, 0))
                  }}
                >
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button type="submit">Next</Button>
                ) : (
                  <Button onClick={finish} disabled={complete.isPending}>
                    {complete.isPending && <Loader2 className="animate-spin" aria-hidden />}
                    Create restaurant
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
