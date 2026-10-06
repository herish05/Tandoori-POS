# Tandoori-POS Architecture

## Goals

Offline-first POS: the desktop app is the source of truth at the counter and works with no internet. A cloud backend (later phases) syncs, never blocks, local operation.

## System overview

```mermaid
flowchart LR
  subgraph Desktop[Electron desktop app]
    R[Renderer: React + TS] -- window.tandoori (contextBridge) --> P[Preload]
    P -- validated IPC --> M[Main process]
    M --> DB[(SQLite + Drizzle)]
    M --> L[Log files]
  end
  M -. later phases: LAN Socket.IO .-> K[Kitchen / other terminals]
  M -. later phases: sync queue .-> C[Cloud API: Node + MongoDB + Redis]
```

## Process boundaries

- **Main** owns everything with side effects: SQLite, filesystem, logging, window control, (later) printing and sync.
- **Preload** exposes a small typed API (`TandooriApi`) via `contextBridge`. No Node access for the renderer.
- **Renderer** is pure UI. It talks to main only through `src/services/*`, which wrap `window.tandoori` and unwrap `IpcResult`.
- **Shared** (`electron/shared`) holds channel names, types and zod schemas used by both sides.

## IPC contract

Every handler is registered through `createIpcRegistrar`, which:

1. verifies the sender frame, origin and window,
2. parses input with a zod schema,
3. returns `IpcResult<T>` – `{ ok: true, data }` or `{ ok: false, error: { message, requestId } }`,
4. logs technical details with the request id.

## Data layer

- SQLite via `better-sqlite3`, WAL, `foreign_keys=ON`, `synchronous=FULL`.
- Drizzle schema; every table uses `baseColumns()`: `id` (uuid), `created_at`, `updated_at`, `deleted_at` (soft delete), `version`, `sync_status`. This makes every row sync-ready.
- Migrations in `drizzle/` are applied at startup; the health check compares applied vs. expected counts.
- Repositories live in `electron/main/db`; handlers never write SQL directly.

## Renderer

- React 19, React Router (hash router), Zustand (connectivity, persisted UI prefs), TanStack Query (server/IPC state), Tailwind + shadcn-style components.
- Three layouts: **POS** (cashier), **Admin** (collapsible sidebar), **Kitchen** (dark KDS).
- Table-status colours are CSS variables, defined once and reused by legend and table cards.
- Error boundaries at app and route level; startup screen runs the health check before login.

## Authentication and authorisation (Phase 2)

- Tables: `restaurants`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
  `sessions`, `audit_logs` (migration `0001_auth_and_restaurant.sql`).
- Permission codes live in `electron/shared/permissions.ts` and are synced into the
  `permissions` table at startup; OWNER is re-granted every code. `x.manage` implies `x.view`.
- `handleProtected` in the IPC registrar checks the session and the required permission
  before the handler runs, and audits denials. Nobody can grant or alter access they do not hold;
  the OWNER role is built in and immutable.
- Renderer: `SessionProvider` restores state from main, `RequireAuth` guards routes
  (redirect to `/login`, or the Forbidden page when the role lacks the permission),
  `useAuthStore` mirrors the signed-in user for UI hints only. The main process is the authority.
- TanStack Query keys beginning with `system` survive sign-out; all other cached data is cleared.
- IPC: `setup:*`, `auth:*`, `restaurant:*`, `users:*`, `roles:*`, `permissions:list`, `audit:list`.

## Tables and areas (Phase 3)

- Tables: `areas`, `dining_tables` (migration `0002_tables_and_areas.sql`). A table has a type
  (`AC`, `NON_AC`, `OUTDOOR`, `OTHER`), capacity, area, active flag, floor position (`pos_x`, `pos_y`)
  and a status; occupied tables also store `opened_at`, `opened_by`, `guest_count`.
- Floor grid is 16 columns x 10 rows (`FLOOR_GRID` in `electron/shared/tables.ts`); the admin Layout tab
  places tables on it and the POS table view renders the same positions (compact: empty rows/columns hidden).
- Status set and transitions are enforced in `TableService` (open: idle -> OCCUPIED, close: OCCUPIED/PAID -> AVAILABLE,
  block/unblock). Ordering-driven statuses (KOT, bill, payment) arrive with later phases.
- Permissions: `tables.view`, `tables.manage` (CRUD, layout), `tables.operate` (open/close/block). manage and operate imply view.
- IPC: `areas:list|create|update|set-active|delete`, `tables:list|floor|create|update|set-active|save-layout|open|close|block|unblock`.
- Renderer: reusable `TableCard`, `FloorGrid`, `TableActions`; POS polls the floor every 5 seconds.

## Menu (Phase 4)

- Tables (migration `0003_menu_management.sql`): `kitchen_stations`, `categories`, `tax_categories`,
  `menu_items`, `menu_variants`, `menu_addons`, `menu_item_addons` (join table, no sync columns; the
  item's version is bumped when its add-ons change). Nothing is seeded: a fresh install has an empty menu.
- Money is stored as integer paise (`price`, `cost_price`); tax rates as basis points (`rate_bps`).
  The renderer converts at the edge (`src/lib/money.ts`), so there is no floating-point money anywhere.
- Add-ons have a kind: `ADDON` (priced) or `MODIFIER` (free, price must be 0). Items choose which ones they offer.
- The kitchen station of an item is its own station if set, otherwise its category's (`effectiveStation*`).
- When an item has variants, its `price`/`cost_price` are derived from the default variant on the server
  (the first becomes default if none is flagged). Updating variants keeps their identity (matched by id).
- Guards: a station or tax category in use cannot be deactivated or deleted; a category with items cannot be
  deleted (deactivate it); deleting an add-on removes it from items; deleting an item is a soft delete.
- Search and filters (text over name, description and category; category, food type, availability, status,
  best seller) run in the main process (`itemFilterSchema`), with `%` and `_` treated as plain characters.
- Item pictures are small data URLs (at most 90,000 characters). The screen downsizes pictures before saving.
- Sample data: demo rows carry `is_demo`, are loaded only by an explicit admin action, only when the build
  allows it (`allowDemoData`, off in production), only into an empty menu, and can be removed in one click.
  Sample rows that real data now depends on are kept as real data. Sample data is never created automatically.
- Permissions: `menu.view`, `menu.manage` (everything), `menu.operate` (mark items sold out / available).
  manage implies operate and view; operate implies view (`ALSO_IMPLIED`).
- IPC: `menu:stations|categories|tax-categories|addons:list|create|update|set-active|delete`,
  `menu:items:list|create|update|set-active|set-availability|delete`, `menu:demo:status|load|remove`.
- Renderer: one admin page (`/admin/menu`) with tabs Items, Categories, Add-ons & modifiers, Kitchen stations
  and Tax categories. The shared `MenuListPanel` powers the four simple lists.

## Orders (Phase 5)

- Tables (migration `0004_order_management.sql`): `orders`, `order_items`, `order_item_addons`,
  `document_sequences`. Nothing is seeded. Every order line is a snapshot (name, variant, unit price, tax
  rate, kitchen station, add-ons) taken from the menu on the server, so later menu edits never rewrite
  history and the renderer can never set a price.
- Order numbers look like `TB-ORD-000001`. The prefix is derived from the restaurant name (initials of
  its words) and the counter lives in `document_sequences`, advanced inside the same transaction that
  creates the order, so numbers are never duplicated. The same table will number KOTs and bills later.
- Statuses: `DRAFT`, `CONFIRMED`, `KOT_PENDING`, `PREPARING`, `READY`, `SERVED`, `BILL_REQUESTED`,
  `COMPLETED`, `CANCELLED`. Types: `DINE_IN`, `TAKEAWAY`, `PICKUP`, `DELIVERY`. Allowed moves are listed in
  `ORDER_TRANSITIONS`; every status change is guarded by the status the caller last saw, so two terminals
  cannot overwrite each other.
- Lines are `NEW` (saved, not yet sent), `SENT` (the kitchen has it) or `CANCELLED`. A `NEW` line can be
  changed or removed freely; a `SENT` line can only be cancelled, with a reason, and needs `orders.cancel`.
- Every write (create, add items, update or remove a line, send, status, cancel) runs in one database
  transaction together with the table update and the audit entry.
- Table state follows the order automatically (`TABLE_STATUS_FOR_ORDER`): taking an order claims the table,
  and cancelling it frees it. A table has at most one active order (partial unique index), and a table with
  an order in progress cannot be closed by hand.
- Cancelling: a draft can be dropped without a reason; any other cancel needs a reason (3+ characters) and
  `orders.cancel`. Served, billed and finished orders cannot be cancelled. `COMPLETED` is reserved for billing.
- The POS catalog (`orders:catalog`) is a separate, trimmed read of the menu (available categories and items
  with variants and add-ons; no cost prices, no pictures).
- Permissions: `orders.view`, `orders.operate` (create, edit, send, change status), `orders.cancel` (cancel
  sent items and orders; implies operate and view).
- IPC: `orders:catalog|list|get|create|update|add-items|update-line|remove-line|cancel-line|send|set-status|cancel`.
- Audit actions: `order.created|updated|items_added|item_updated|item_removed|item_cancelled|sent|status_changed|cancelled`.
- Renderer: `/pos` shows Tables and Orders tabs; a free table offers "Take order", a busy table opens its
  order. `/pos/orders/new?type=&table=&guests=` starts an order and `/pos/orders/:id` opens one. The
  screen is a menu browser (categories, search, item dialog with size, extras, preferences and instructions)
  beside the order panel (saved lines, staged cart, subtotal, actions). Open orders refresh every 5 seconds.
- Not here yet: KOT creation and printing, tax, discounts and payment (Phase 7), merging, splitting and
  moving orders.

## Logging

Channels `app`, `security`, `sync`, `printer`, `database` -> JSON lines, daily files, redaction of sensitive keys, 30-day retention. Renderer logs go through IPC with a flood limit.

## Phase plan

| #   | Phase                                                                                                                                                              | Outcome                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | Foundation (done)                                                                                                                                                  | Shell, IPC, SQLite, migrations, logging, health, tests     |
| 2   | Authentication and restaurant setup (done)                                                                                                                         | First-run setup, users, roles, password login, permissions |
| 3   | Areas and tables (done)                                                                                                                                            | Table CRUD, table view with live status                    |
| 4   | Menu management (done)                                                                                                                                             | Categories, items, variants, add-ons, taxes                |
| 5   | Ordering (done)                                                                                                                                                    | Dine-in / takeaway / delivery orders, cart, hold           |
| 6   | KOT and kitchen                                                                                                                                                    | KOT generation, KDS flow                                   |
| 7   | Billing and payments                                                                                                                                               | Bills, discounts, split, payment modes, settlement         |
| 8+  | Printing, inventory, purchases, customers, reservations, reports, shifts/cash drawer, LAN sync, cloud backend and sync, backup/restore, installers and auto-update | Per the product spec                                       |

Each phase ships working, tested software with a written report; no phase starts until the previous one passes tests.
