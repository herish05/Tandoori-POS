import type {
  CloseDayInput,
  DayClosing,
  DayClosingFilterInput,
  DayClosingListItem,
  DayOverview,
  DayStatus,
  DayStatusInput,
  ReopenDayInput
} from '@shared/day-closing'
import { getApi, unwrap } from '@/lib/ipc'

export const dayClosingService = {
  overview: (): Promise<DayOverview> => unwrap(getApi().day.overview()),
  status: (input: DayStatusInput = {}): Promise<DayStatus> => unwrap(getApi().day.status(input)),
  list: (filter: DayClosingFilterInput = {}): Promise<DayClosingListItem[]> =>
    unwrap(getApi().day.list(filter)),
  get: (id: string): Promise<DayClosing> => unwrap(getApi().day.get(id)),
  close: (input: CloseDayInput): Promise<DayClosing> => unwrap(getApi().day.close(input)),
  reopen: (input: ReopenDayInput): Promise<DayClosing> => unwrap(getApi().day.reopen(input))
}
