import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoleInputSchema, createStaffInputSchema } from '@shared/auth-schemas'
import { withImpliedPermissions, type PermissionCode } from '@shared/permissions'
import {
  FLOOR_GRID,
  createAreaInputSchema,
  createTableInputSchema,
  openTableInputSchema,
  saveLayoutInputSchema,
  updateTableInputSchema,
  type CreateTableInput,
  type TableStatus
} from '@shared/tables'
import type { AuthContext } from '@main/auth/types'
import { diningTables } from '@main/db/schema'
import { completeSetup, createTestApp, failureCode, loginAsOwner, type TestApp } from './helpers'

const STAFF_PASSWORD = 'Biryani-2026'

describe('areas and tables', () => {
  let app: TestApp
  let owner: AuthContext

  const makeArea = (name: string, extra: Record<string, unknown> = {}) =>
    app.services.areas.create(owner, createAreaInputSchema.parse({ name, ...extra }))

  const makeTable = (areaId: string, tableNumber: string, extra: Partial<CreateTableInput> = {}) =>
    app.services.tables.create(
      owner,
      createTableInputSchema.parse({ areaId, tableNumber, capacity: 4, type: 'AC', ...extra })
    )

  const forceStatus = (id: string, status: TableStatus) => {
    app.handle.db.update(diningTables).set({ status }).where(eq(diningTables.id, id)).run()
  }

  const cell = (t: { positionX: number; positionY: number }) =>
    `${String(t.positionX)},${String(t.positionY)}`

  beforeEach(async () => {
    app = createTestApp()
    await completeSetup(app)
    await loginAsOwner(app)
    owner = app.services.auth.authorize([])
  })
  afterEach(() => {
    app.cleanup()
  })

  describe('validation', () => {
    it('rejects bad capacity, type and positions, and blanks the optional display name', () => {
      const base = { areaId: crypto.randomUUID(), tableNumber: 'T1', capacity: 4, type: 'AC' }
      expect(createTableInputSchema.safeParse(base).success).toBe(true)
      for (const patch of [
        { capacity: 0 },
        { capacity: 51 },
        { capacity: 2.5 },
        { type: 'ROOFTOP' },
        { tableNumber: '   ' },
        { positionX: FLOOR_GRID.columns, positionY: 0 },
        { positionX: 0, positionY: -1 }
      ]) {
        expect(createTableInputSchema.safeParse({ ...base, ...patch }).success).toBe(false)
      }
      expect(createTableInputSchema.parse({ ...base, displayName: '  ' }).displayName).toBeNull()
      expect(createAreaInputSchema.safeParse({ name: ' ' }).success).toBe(false)
      expect(
        openTableInputSchema.safeParse({ id: crypto.randomUUID(), guestCount: 0 }).success
      ).toBe(false)
    })
  })

  describe('areas', () => {
    it('creates, lists, renames and rejects a duplicate name in any letter case', async () => {
      const dining = makeArea('Main Hall', { floor: 'Ground floor', sortOrder: 1 })
      makeArea('Terrace', { sortOrder: 0 })
      expect(app.services.areas.list().map((a) => a.name)).toEqual(['Terrace', 'Main Hall'])
      expect(dining).toMatchObject({ floor: 'Ground floor', isActive: true, tableCount: 0 })

      expect(await failureCode(() => makeArea('main hall'))).toBe('CONFLICT')

      const renamed = app.services.areas.update(owner, {
        id: dining.id,
        name: 'Family Hall',
        floor: 'First floor',
        description: null,
        sortOrder: 1
      })
      expect(renamed).toMatchObject({ name: 'Family Hall', floor: 'First floor' })
      expect(await failureCode(() => makeArea('FAMILY HALL'))).toBe('CONFLICT')
    })

    it('hides a deactivated area and its tables from the POS floor', () => {
      const hall = makeArea('Hall')
      const roof = makeArea('Roof')
      makeTable(hall.id, 'A1')
      makeTable(roof.id, 'R1')
      expect(app.services.tables.floor().map((a) => a.name)).toEqual(['Hall', 'Roof'])

      app.services.areas.setActive(owner, { id: roof.id, isActive: false })
      const floor = app.services.tables.floor()
      expect(floor.map((a) => a.name)).toEqual(['Hall'])
      // The admin list still shows everything.
      expect(app.services.tables.list()).toHaveLength(2)
      expect(app.services.areas.list().find((a) => a.id === roof.id)?.isActive).toBe(false)

      app.services.areas.setActive(owner, { id: roof.id, isActive: true })
      expect(app.services.tables.floor().map((a) => a.name)).toEqual(['Hall', 'Roof'])
    })

    it('cannot be deactivated while one of its tables is in use', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'A1')
      app.services.tables.open(owner, { id: table.id })
      expect(
        await failureCode(() =>
          app.services.areas.setActive(owner, { id: hall.id, isActive: false })
        )
      ).toBe('CONFLICT')

      app.services.tables.close(owner, table.id)
      app.services.areas.setActive(owner, { id: hall.id, isActive: false })
    })

    it('can be deleted only when empty', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'A1')
      expect(
        await failureCode(() => {
          app.services.areas.delete(owner, hall.id)
        })
      ).toBe('CONFLICT')

      const empty = makeArea('Empty')
      app.services.areas.delete(owner, empty.id)
      expect(app.services.areas.list().map((a) => a.name)).toEqual(['Hall'])
      expect(
        await failureCode(() => {
          app.services.areas.delete(owner, empty.id)
        })
      ).toBe('NOT_FOUND')
      // The name can be reused once the old area is gone.
      expect(makeArea('Empty').name).toBe('Empty')
      expect(table.areaId).toBe(hall.id)
    })
  })

  describe('tables', () => {
    it('creates tables with defaults, in the first free spot, with unique numbers', async () => {
      const hall = makeArea('Hall')
      const first = makeTable(hall.id, 'T1')
      const second = makeTable(hall.id, 'T2', { displayName: 'Window seat', type: 'NON_AC' })

      expect(first).toMatchObject({
        displayName: 'Table T1',
        status: 'AVAILABLE',
        isActive: true,
        positionX: 0,
        positionY: 0,
        areaName: 'Hall'
      })
      expect(second).toMatchObject({
        displayName: 'Window seat',
        type: 'NON_AC',
        positionX: 1,
        positionY: 0
      })

      // Numbers are unique across the restaurant, whatever the letter case or area.
      const roof = makeArea('Roof')
      expect(await failureCode(() => makeTable(roof.id, 't1'))).toBe('CONFLICT')
      // An explicit spot that is taken is refused.
      expect(
        await failureCode(() => makeTable(hall.id, 'T3', { positionX: 1, positionY: 0 }))
      ).toBe('CONFLICT')
      expect(makeTable(hall.id, 'T3', { positionX: 5, positionY: 4 })).toMatchObject({
        positionX: 5,
        positionY: 4
      })
      expect(await failureCode(() => makeTable(crypto.randomUUID(), 'X9'))).toBe('NOT_FOUND')
    })

    it('lists tables in natural order (T2 before T10)', () => {
      const hall = makeArea('Hall')
      for (const n of ['T10', 'T2', 'T1']) makeTable(hall.id, n)
      expect(app.services.tables.list().map((t) => t.tableNumber)).toEqual(['T1', 'T2', 'T10'])
    })

    it('fills a whole floor plan and then says it is full', async () => {
      const hall = makeArea('Hall')
      const capacity = FLOOR_GRID.columns * FLOOR_GRID.rows
      for (let i = 0; i < capacity; i++) makeTable(hall.id, `N${String(i)}`)
      expect(await failureCode(() => makeTable(hall.id, 'ONE-TOO-MANY'))).toBe('CONFLICT')
      const cells = new Set(app.services.tables.list().map(cell))
      expect(cells.size).toBe(capacity)
    })

    it('edits a table, and refuses to move one that is open to another area', async () => {
      const hall = makeArea('Hall')
      const roof = makeArea('Roof')
      const table = makeTable(hall.id, 'T1')
      makeTable(hall.id, 'T2')

      const edited = app.services.tables.update(
        owner,
        updateTableInputSchema.parse({
          id: table.id,
          areaId: roof.id,
          tableNumber: 'R-1',
          displayName: 'Sky seat',
          capacity: 6,
          type: 'OUTDOOR'
        })
      )
      expect(edited).toMatchObject({
        areaName: 'Roof',
        tableNumber: 'R-1',
        displayName: 'Sky seat',
        capacity: 6,
        type: 'OUTDOOR',
        positionX: 0,
        positionY: 0
      })

      app.services.tables.open(owner, { id: table.id })
      const back = updateTableInputSchema.parse({
        id: table.id,
        areaId: hall.id,
        tableNumber: 'R-1',
        capacity: 6,
        type: 'OUTDOOR'
      })
      expect(await failureCode(() => app.services.tables.update(owner, back))).toBe('CONFLICT')
      // Number clash with another table.
      const clash = updateTableInputSchema.parse({ ...back, areaId: roof.id, tableNumber: 'T2' })
      expect(await failureCode(() => app.services.tables.update(owner, clash))).toBe('CONFLICT')
    })

    it('deactivates a free table (freeing its spot) and reactivates it somewhere free', () => {
      const hall = makeArea('Hall')
      const first = makeTable(hall.id, 'T1')
      expect(cell(first)).toBe('0,0')

      app.services.tables.setActive(owner, { id: first.id, isActive: false })
      expect(app.services.tables.floor()[0]?.tables).toHaveLength(0)

      const replacement = makeTable(hall.id, 'T2')
      expect(cell(replacement)).toBe('0,0')

      const back = app.services.tables.setActive(owner, { id: first.id, isActive: true })
      expect(back.isActive).toBe(true)
      expect(cell(back)).not.toBe('0,0')
    })

    it('does not deactivate a table that is open', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')
      app.services.tables.open(owner, { id: table.id, guestCount: 2 })
      expect(
        await failureCode(() =>
          app.services.tables.setActive(owner, { id: table.id, isActive: false })
        )
      ).toBe('CONFLICT')
    })
  })

  describe('floor layout', () => {
    it('moves tables and lets two tables swap places', () => {
      const hall = makeArea('Hall')
      const a = makeTable(hall.id, 'A')
      const b = makeTable(hall.id, 'B')
      const c = makeTable(hall.id, 'C')

      const swapped = app.services.tables.saveLayout(
        owner,
        saveLayoutInputSchema.parse({
          areaId: hall.id,
          positions: [
            { id: a.id, positionX: b.positionX, positionY: b.positionY },
            { id: b.id, positionX: a.positionX, positionY: a.positionY },
            { id: c.id, positionX: 9, positionY: 7 }
          ]
        })
      )
      const byNumber = Object.fromEntries(swapped.map((t) => [t.tableNumber, cell(t)]))
      expect(byNumber).toEqual({ A: '1,0', B: '0,0', C: '9,7' })

      const log = app.services.audit.list({ page: 1, pageSize: 25, actionPrefix: 'table.layout' })
      expect(log.items[0]?.details).toEqual({ movedTables: 3 })
    })

    it('rejects a layout that stacks two tables and leaves everything where it was', async () => {
      const hall = makeArea('Hall')
      const a = makeTable(hall.id, 'A')
      const b = makeTable(hall.id, 'B')
      const before = app.services.tables.list().map(cell)

      expect(
        await failureCode(() =>
          app.services.tables.saveLayout(
            owner,
            saveLayoutInputSchema.parse({
              areaId: hall.id,
              positions: [{ id: a.id, positionX: b.positionX, positionY: b.positionY }]
            })
          )
        )
      ).toBe('CONFLICT')
      expect(
        await failureCode(() =>
          app.services.tables.saveLayout(
            owner,
            saveLayoutInputSchema.parse({
              areaId: hall.id,
              positions: [
                { id: a.id, positionX: 7, positionY: 7 },
                { id: b.id, positionX: 7, positionY: 7 }
              ]
            })
          )
        )
      ).toBe('CONFLICT')
      expect(app.services.tables.list().map(cell)).toEqual(before)
    })

    it('rejects tables from another area and spots outside the floor plan', async () => {
      const hall = makeArea('Hall')
      const roof = makeArea('Roof')
      makeTable(hall.id, 'A')
      const other = makeTable(roof.id, 'R')

      expect(
        await failureCode(() =>
          app.services.tables.saveLayout(
            owner,
            saveLayoutInputSchema.parse({
              areaId: hall.id,
              positions: [{ id: other.id, positionX: 3, positionY: 3 }]
            })
          )
        )
      ).toBe('NOT_FOUND')
      expect(
        saveLayoutInputSchema.safeParse({
          areaId: hall.id,
          positions: [{ id: other.id, positionX: FLOOR_GRID.columns, positionY: 0 }]
        }).success
      ).toBe(false)
    })
  })

  describe('opening and closing', () => {
    it('opens a free table, recording who and when, and closes it again', () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')

      app.clock.advance(1000)
      const opened = app.services.tables.open(owner, { id: table.id, guestCount: 3 })
      expect(opened).toMatchObject({
        status: 'OCCUPIED',
        guestCount: 3,
        openedByName: 'Olivia Owner'
      })
      expect(opened.openedAt).toBe(new Date(app.clock.now).toISOString())
      expect(app.services.tables.floor()[0]?.tables[0]?.status).toBe('OCCUPIED')

      app.clock.advance(25 * 60_000)
      const closed = app.services.tables.close(owner, table.id)
      expect(closed).toMatchObject({
        status: 'AVAILABLE',
        guestCount: null,
        openedAt: null,
        openedByName: null
      })

      const actions = app.services.audit
        .list({ page: 1, pageSize: 25, actionPrefix: 'table.' })
        .items.map((e) => [e.action, e.details])
      expect(actions).toContainEqual(['table.opened', { tableNumber: 'T1', guestCount: 3 }])
      expect(actions).toContainEqual(['table.closed', { tableNumber: 'T1', openMinutes: 25 }])
    })

    it('will not open a table twice, or close one that is not open', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')
      expect(await failureCode(() => app.services.tables.close(owner, table.id))).toBe('CONFLICT')

      app.services.tables.open(owner, { id: table.id })
      expect(await failureCode(() => app.services.tables.open(owner, { id: table.id }))).toBe(
        'CONFLICT'
      )
      app.services.tables.close(owner, table.id)
      expect(await failureCode(() => app.services.tables.close(owner, table.id))).toBe('CONFLICT')
    })

    it('opens a reserved table but not one with an order in progress', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')

      forceStatus(table.id, 'RESERVED')
      expect(app.services.tables.open(owner, { id: table.id }).status).toBe('OCCUPIED')

      for (const status of [
        'KOT_PENDING',
        'PREPARING',
        'BILL_REQUESTED',
        'PAYMENT_PENDING'
      ] as const) {
        forceStatus(table.id, status)
        expect(await failureCode(() => app.services.tables.open(owner, { id: table.id }))).toBe(
          'CONFLICT'
        )
        // Closing would lose the order, so it is refused until the order is settled.
        expect(await failureCode(() => app.services.tables.close(owner, table.id))).toBe('CONFLICT')
      }

      forceStatus(table.id, 'PAID')
      expect(app.services.tables.close(owner, table.id).status).toBe('AVAILABLE')
    })

    it('blocks and unblocks a free table; a blocked table cannot be opened', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')

      expect(app.services.tables.block(owner, table.id).status).toBe('BLOCKED')
      expect(await failureCode(() => app.services.tables.open(owner, { id: table.id }))).toBe(
        'CONFLICT'
      )
      expect(await failureCode(() => app.services.tables.block(owner, table.id))).toBe('CONFLICT')

      expect(app.services.tables.unblock(owner, table.id).status).toBe('AVAILABLE')
      expect(await failureCode(() => app.services.tables.unblock(owner, table.id))).toBe('CONFLICT')

      app.services.tables.open(owner, { id: table.id })
      expect(await failureCode(() => app.services.tables.block(owner, table.id))).toBe('CONFLICT')
    })

    it('will not open an inactive table or one in an inactive area', async () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')
      app.services.tables.setActive(owner, { id: table.id, isActive: false })
      expect(await failureCode(() => app.services.tables.open(owner, { id: table.id }))).toBe(
        'CONFLICT'
      )

      app.services.tables.setActive(owner, { id: table.id, isActive: true })
      app.services.areas.setActive(owner, { id: hall.id, isActive: false })
      expect(await failureCode(() => app.services.tables.open(owner, { id: table.id }))).toBe(
        'CONFLICT'
      )
      expect(
        await failureCode(() => app.services.tables.open(owner, { id: crypto.randomUUID() }))
      ).toBe('NOT_FOUND')
    })

    it('keeps an open table open across an application restart', () => {
      const hall = makeArea('Hall')
      const table = makeTable(hall.id, 'T1')
      app.services.tables.open(owner, { id: table.id, guestCount: 4 })

      const restarted = app.restart()
      expect(restarted.tables.floor()[0]?.tables[0]).toMatchObject({
        tableNumber: 'T1',
        status: 'OCCUPIED',
        guestCount: 4
      })
    })
  })

  describe('permissions', () => {
    const makeRole = (name: string, permissions: PermissionCode[]) =>
      app.services.roles.create(owner, createRoleInputSchema.parse({ name, permissions }))

    const signInAs = async (username: string, roleIds: string[]): Promise<void> => {
      const created = await app.services.users.create(
        owner,
        createStaffInputSchema.parse({
          username,
          password: STAFF_PASSWORD,
          fullName: `Staff ${username}`,
          roleIds
        })
      )
      expect(created.username).toBe(username)
      app.services.auth.logout()
      await app.services.auth.login({ username, password: STAFF_PASSWORD })
      const ctx = app.services.auth.authorize([], { allowPasswordChange: true })
      await app.services.auth.changePassword(ctx, {
        currentPassword: STAFF_PASSWORD,
        newPassword: 'Fresh-Password-9',
        confirmPassword: 'Fresh-Password-9'
      })
    }

    it('gives the OWNER the table permissions and implies view from manage and operate', () => {
      const ownerRole = app.services.roles.list().find((r) => r.name === 'OWNER')
      expect(ownerRole?.permissions).toEqual(
        expect.arrayContaining(['tables.view', 'tables.manage', 'tables.operate'])
      )
      expect(withImpliedPermissions(['tables.operate'])).toEqual(['tables.view', 'tables.operate'])
      expect(withImpliedPermissions(['tables.manage'])).toEqual(['tables.view', 'tables.manage'])
      expect(makeRole('Waiter', ['tables.operate']).permissions).toEqual([
        'tables.view',
        'tables.operate'
      ])
    })

    it('lets a waiter open tables but not change the setup; a viewer can only look', async () => {
      const waiter = makeRole('Waiter', ['pos.access', 'tables.operate'])
      const viewer = makeRole('Viewer', ['pos.access', 'tables.view'])
      await signInAs('waiter1', [waiter.id])
      expect(app.services.auth.authorize(['tables.operate']).username).toBe('waiter1')
      expect(app.services.auth.authorize(['tables.view']).username).toBe('waiter1')
      expect(await failureCode(() => app.services.auth.authorize(['tables.manage']))).toBe(
        'FORBIDDEN'
      )

      await signInAs('viewer1', [viewer.id])
      expect(app.services.auth.authorize(['tables.view']).username).toBe('viewer1')
      expect(await failureCode(() => app.services.auth.authorize(['tables.operate']))).toBe(
        'FORBIDDEN'
      )
      expect(await failureCode(() => app.services.auth.authorize(['tables.manage']))).toBe(
        'FORBIDDEN'
      )

      const denied = app.services.audit.list({
        page: 1,
        pageSize: 25,
        actionPrefix: 'auth.permission_denied'
      })
      expect(denied.total).toBeGreaterThanOrEqual(2)
    })
  })
})
