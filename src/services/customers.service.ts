import type {
  AddAddressInput,
  CreateCustomerInput,
  CustomerDetail,
  CustomerFilterInput,
  CustomerLookupInput,
  CustomerLookupResult,
  CustomerSummary,
  UpdateAddressInput,
  UpdateCustomerInput
} from '@shared/customers'
import { getApi, unwrap } from '@/lib/ipc'

export const customerService = {
  list: (filter: CustomerFilterInput = {}): Promise<CustomerSummary[]> =>
    unwrap(getApi().customers.list(filter)),
  get: (id: string): Promise<CustomerDetail> => unwrap(getApi().customers.get(id)),
  lookup: (input: CustomerLookupInput): Promise<CustomerLookupResult[]> =>
    unwrap(getApi().customers.lookup(input)),
  create: (input: CreateCustomerInput): Promise<CustomerDetail> =>
    unwrap(getApi().customers.create(input)),
  update: (input: UpdateCustomerInput): Promise<CustomerDetail> =>
    unwrap(getApi().customers.update(input)),
  remove: (id: string): Promise<null> => unwrap(getApi().customers.delete(id)),
  addAddress: (input: AddAddressInput): Promise<CustomerDetail> =>
    unwrap(getApi().customers.addAddress(input)),
  updateAddress: (input: UpdateAddressInput): Promise<CustomerDetail> =>
    unwrap(getApi().customers.updateAddress(input)),
  removeAddress: (id: string): Promise<CustomerDetail> =>
    unwrap(getApi().customers.removeAddress(id))
}
