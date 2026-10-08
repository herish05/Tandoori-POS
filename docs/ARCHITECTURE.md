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

## Kitchen tickets and printing (Phase 6)

- Tables (migration `0005_kot_and_printing.sql`): `kots`, `kot_items`, `printers`, `print_jobs`. Nothing is
  seeded. Ticket lines are snapshots of the order line (name, variant, quantity, add-ons, instructions).
- Sending an order creates one KOT per kitchen station in the same transaction as the order change. Numbers
  look like `TB-KOT-000001` and come from `document_sequences`. Items added after the first send get an
  additional KOT (`is_additional`); the first ticket is never rewritten.
- Statuses: `NEW`, `ACCEPTED`, `PREPARING`, `READY`, `SERVED`, `CANCELLED`. Allowed moves are in
  `KOT_TRANSITIONS`; each change is guarded by the status the caller last saw. The order status follows its
  tickets (for example `PREPARING` while any ticket is preparing).
- Immutability: SQL triggers refuse changes to a ticket's identity, numbering and lines after creation. The
  only controlled changes are status moves, print bookkeeping, and cancelling (a ticket, or one item on it,
  with a reason). Cancelling an item on a printed ticket flags it for reprint (`printed_revision`).
- Printers: one printer per station plus at most one shared default (partial unique indexes). The first shared
  printer becomes the default automatically. Kinds: `NETWORK` (ESC/POS over TCP, default port 9100) and
  `SYSTEM` (Electron print API, Electron-only). Drivers sit behind a small interface and are injectable in tests.
- Printing flow: `PrintService` renders the ticket text (`kot-template.ts`, 58 or 80 mm), picks the station
  printer, falls back to the default, and records every attempt in `print_jobs`. If no printer is set up or
  the printer cannot be reached, the ticket stays `print_status = FAILED`, an audit entry `kot.print_failed`
  is written, and the UI opens a printable preview (with "Print from this computer") and a Reprint action.
  Nothing fails silently, and driver internals never reach the message shown to staff.
- Permissions: `kitchen.access` (see the board), `kitchen.operate` (move and cancel tickets, implies access),
  `printers.view`, `printers.manage`.
- IPC: `kots:list|get|board|set-status|cancel|preview|print`,
  `printers:list|create|update|delete|test|system-devices`. `orders:send` now returns the created tickets
  and their print outcome.
- Audit actions: `kot.created|status_changed|cancelled|item_cancelled|printed|reprinted|print_failed`,
  `printer.created|updated|deleted|test_failed`.
- Renderer: `/kitchen` is the board (columns New, Accepted, Preparing, Ready; station filter; refreshes by
  polling), `/admin/kot` lists and previews tickets, `/admin/printers` manages printers and prints a test
  page, and the order screen lists its tickets.
- Not here yet: live push to kitchen screens (Socket.IO, next phase); the OS printer driver and real thermal
  printers are not exercised by automated tests.

## Billing (Phase 8)

- Tables (migration `0006_billing_and_payments.sql`): `billing_settings`, `bills`, `bill_items`, `bill_taxes`,
  `bill_discounts`, `payments`. Nothing is seeded. Numbers look like `TB-BILL-000001` and come from
  `document_sequences`. A bill is a frozen snapshot of the order: lines, tax rates, discounts, settings
  and every figure, so later menu or setting changes never rewrite it. 17 SQL triggers lock the amounts,
  the identity and the payments of a bill after creation.
- Money is whole paise (100 paise = 1 rupee) everywhere; percentages are basis points (1% = 100). There is
  no floating point in any money calculation. The renderer never sends a total: the main process works
  out every figure from the order, the discounts and the billing settings.
- `electron/main/billing/calculator.ts` is a pure function (no database, no UI): item subtotal, item
  discounts, bill discount, service charge, GST, round-off, grand total. A bill discount and the service
  charge are shared across lines by largest remainder (BigInt) so the parts always add up to the whole.
  Prices are tax-exclusive. Within the state CGST = SGST = half the rate; between states the whole rate is
  IGST. The service charge is worked out on the discounted subtotal, can be limited to dine-in, and can be
  taxable. The total is rounded (half up) to 1, 10, 50 or 100 paise.
- Discounts: percentage or fixed, one per item and one per bill, each with a reason (3 to 200 characters),
  only while the bill is unpaid. Removal is a soft delete so the history stays.
- Payments: CASH, UPI, CARD or OTHER, split across up to 10 lines. Only cash may be handed over for more
  than the amount (change is worked out); OTHER needs a reference; payments can never exceed the balance.
  Paying in full completes the order and moves the table to `PAID`. An empty list settles a zero-total bill.
- Statuses: `PENDING`, `PARTIAL`, `PAID`, `REFUNDED` (Phase 9), `CANCELLED`. A bill is made
  from a `SERVED` or `BILL_REQUESTED` order with no unsent items; generating it sets the order to
  `BILL_REQUESTED`, cancelling it (with a reason, only while unpaid) returns the order to `SERVED`. An order
  cannot be reopened while it has a live bill.
- Permissions: `billing.view`, `billing.operate` (generate, cancel, take payment), `billing.discount`
  (implies operate and view), `billing.manage` (change the billing settings).
- IPC: `billing:settings|update-settings`, `bills:list|get|generate|apply-discount|remove-discount|cancel|pay`.
- Audit actions: `bill.generated|discount_applied|discount_removed|payment_recorded|paid|cancelled`,
  `billing.settings_updated`.
- Renderer: the order screen has "Generate bill" and a link to its bill; `/pos/bills/:id` and
  `/admin/bills/:id` show one bill with discount, payment and cancel actions; `/admin/bills` lists bills;
  `/admin/billing-settings` sets GST mode, service charge and round-off.
- Not here yet: a payment ledger (later phases); the cash drawer is Phase 15. Receipts and refunds are below.

## Receipts and refunds (Phase 9)

- Receipts: `receipt-template.ts` lays the bill out for 58 mm or 80 mm paper (BILL, BILL - PART PAID, RECEIPT,
  RECEIPT - REFUNDED, CANCELLED BILL; TAX INVOICE when a GSTIN is set). The footer is the restaurant's
  receipt footer. `ReceiptService` previews, prints and lists the print history; each print is a
  `print_jobs` row with a `snapshot` of the bill state. A repeat print of the same state is marked
  `DUPLICATE COPY n` and the number is stored in `print_jobs.revision`.
- Refunds: `refunds` and `refund_lines` (immutable, never deleted) give money back only through the methods
  originally used, never above what each took. A fully returned paid bill becomes `REFUNDED`; a part-paid
  bill must be returned in full and becomes `CANCELLED` (its order goes back to `SERVED`). `bills.refunded_total`
  is guarded by triggers, and the status trigger blocks illegal moves (for example `REFUNDED` to anything).
- Permissions: `billing.refund`; `billing.operate` is needed to print. IPC: `bills:refund`,
  `receipts:preview|print|history`. Audit: `bill.refunded`, `bill.receipt_printed|receipt_reprinted|receipt_print_failed`.
- Setting: `billing_settings.auto_print_receipt` prints the receipt right after a payment completes.
- Renderer: bill page has Receipt / Print bill, Refund, refund list, print history; the receipt dialog can also
  print from this computer when no printer is reachable.

## Table operations (Phase 10)

- Shift: moves a running dine-in order to a free (available or reserved) table, up to and including
  `BILL_REQUESTED`. The old table is freed, the new one occupied with the same open time; a live bill and
  its tickets follow the order because the table name on a kitchen ticket is read from the order.
- Merge: moves every line and kitchen ticket of the source order onto the target order and cancels the
  source with the reason "Merged into <order number>". Refused when either order has a live bill or
  has asked for the bill. Lines keep their kitchen state; totals are recalculated on the target.
- Every operation writes an immutable `table_operations` row (SHIFT or MERGE, from/to table and order,
  user, time). A trigger only lets a kitchen ticket change its order when a MERGE row for exactly
  that source and target exists.
- Migration `0008_table_operations`. Permission `tables.transfer` (implies `tables.view`, `orders.view`).
  IPC: `tables:shift`, `tables:merge`. Audit: `order.table_shifted`, `order.tables_merged`.
- Renderer: the order screen of a dine-in order has a Shift / merge button (`TableTransferDialog`):
  free tables for a shift; running tables for a merge, with the choice of which table is kept. Merge is
  disabled while unsaved items are on screen.
- Not here yet: splitting or moving single sent items between orders, one party across joined tables,
  and a history screen for operations (they are in the audit log).

## Takeaway, pickup and delivery (Phase 11)

- Promised time (`orders.promised_at`): optional for takeaway, pickup and delivery; never for dine-in. At most
  7 days ahead and at most 5 minutes in the past (an unchanged value is always kept). Printed on the kitchen
  ticket as "Due by" (delivery) or "Ready by".
- Dispatch (`orders:dispatch`, permission `orders.operate`): only a READY delivery can be sent out with a rider
  name and optional phone. Reassigning the rider keeps the first dispatch time. While out, items cannot change,
  and a delivery cannot be marked delivered (SERVED) before it is dispatched. Audit: `order.dispatched`.
- Takeaway and pickup record `handed_over_at` when marked handed over. Labels come from `orderStatusLabelFor`
  (Ready to dispatch, Out for delivery, Delivered, Ready for pickup, Handed over).
- Charges: `billing_settings` holds a delivery charge, a free-delivery-above amount, a packaging charge and a
  GST rate for each. They are snapshotted onto the bill, are not discounted, carry no service charge, and join
  the GST slab of their rate. Delivery applies to delivery orders only; packaging to every non-dine-in order.
- Migration `0009_delivery_and_pickup`: new columns, the bill-lock trigger extended to the charge columns, and
  triggers refusing rider details on a non-delivery order or a promised time on a dine-in order.
- Renderer: promised-time chips and picker, a dispatch dialog, order-screen buttons, and a "Pickup & delivery"
  board on the POS home (kitchen / ready / out / done columns, late orders highlighted).
- Not here yet: rider master list and cash settlement, delivery zones, delivery charge override, customer
  records (Phase 12, below).

## Customers and reservations (Phase 12)

- Customers are matched by phone number only (normalised to digits). Records hold name, phone, email, notes,
  saved addresses and an active flag; there is no merge, loyalty or coupon support yet.
- Orders link to a customer through `customerId`; the order screen suggests customers while typing a phone
  or name and offers saved-address chips. The customer record shows order and bill history.
- Reservations (`BOOKED`, `SEATED`, `CANCELLED`, `NO_SHOW`) carry guest, party size, time, duration and an
  optional table. Database triggers stop two live bookings overlapping on one table.
- A booked table shows as RESERVED close to its time (derived, not stored). Seating a booking needs
  `reservations.operate` and `tables.operate`; a no-show can only be marked once the time has passed.
- Permissions: `customers.view|manage`, `reservations.view|operate`; customer lookup while taking an order
  needs `orders.operate`.
- Not here: deposits, reminders by SMS or WhatsApp, joined tables for large parties, auto-cancelling bookings
  when a table is deactivated.

## Inventory and recipes (Phase 13)

- Stock items are raw materials with a unit (`KG`, `G`, `L`, `ML`, `PCS`), category, reorder level and a cost per
  unit. Quantities are whole thousandths of the unit (2.5 kg is `2500`), so stock never drifts; money stays in paise.
- Every change goes through an append-only ledger, `stock_movements` (`OPENING`, `STOCK_IN`, `ADJUSTMENT`,
  `WASTAGE`, `CONSUMPTION`, `CONSUMPTION_REVERSAL`). Each row stores the balance after it. Triggers refuse any
  update or delete of a row, and `onHand` on the item always equals the sum of its ledger.
- Stock in may carry a price, which becomes the item's latest cost. Wastage needs a reason and cannot exceed what is
  on hand. A stock count books the difference as an adjustment (nothing is written when it matches).
- A recipe lists the ingredients of one portion. It is set per menu item as a shared recipe, and a size (variant) may
  have its own; a size without one uses the shared recipe. The editor shows ingredient cost against selling price.
- Stock is taken out when an order is sent and its kitchen ticket is issued, in the same transaction
  (`InventoryService.consume`). It goes back (`restore`) when a line, an order or a ticket is cancelled while the
  ticket is still `NEW` or `ACCEPTED`; once cooking has started the stock stays used. Restoring is done once per line.
- Selling is never blocked by stock: it can go below zero, and the item shows as out.
- An ingredient used by a recipe cannot be retired or deleted; an item with any history cannot be deleted, and its
  unit is fixed once stock has been recorded.
- Migration `0011_inventory_and_recipes`. Permissions: `inventory.view`, `inventory.operate` (stock in, wastage,
  counts) and `inventory.manage` (items and recipes). Channels `inventory:*` and `recipes:*`; audit actions
  `inventory.*`.
- Renderer: Inventory page with Stock (summary, low-stock flags, stock in / wastage / count), Movements (the ledger,
  filtered) and Recipes (menu items with coverage, a tab per size, ingredient editor).
- Not here: add-ons and modifiers using stock, unit conversion (kg to g), weighted-average cost, batches and expiry,
  transfers between locations, automatic sold-out, reports (now Phase 17). Purchasing is Phase 14.

## Purchasing and suppliers (Phase 14)

- Tables: `suppliers`, `purchases`, `purchase_lines`, `supplier_payments` (migration `0012`). Money is integer
  paise and quantities are thousandths of the item's unit. `purchases` has CHECKs `total = subtotal - discount + tax`
  and `amount_paid <= total`.
- Lifecycle: a purchase starts as a DRAFT (editable, no stock effect) and becomes RECEIVED or CANCELLED, never
  back. Triggers enforce the flow, freeze a non-draft purchase and its lines, forbid deleting purchases, lines and
  payments, take payments only against RECEIVED purchases, make payment fields immutable and allow a payment to be
  voided only once.
- Receiving, in one transaction: checks each item is active and its unit unchanged, posts a `STOCK_IN` ledger entry
  per line through `InventoryService.receiveStock` and sets the item's unit cost to the purchase price, then marks
  the purchase RECEIVED. Purchase numbers come from the same numbering service (`PREFIX-PUR-000001`).
- Payments: part or full, by cash, UPI, bank, cheque or other, never more than what is outstanding. A wrong payment
  is voided with a reason (kept on record) and the amount becomes due again. Payment status is derived: not due,
  unpaid, partial, paid.
- Permissions: `suppliers.view|manage`, `purchases.view|operate|pay`. Channels `suppliers:*` and `purchases:*`;
  audit actions `supplier.*` and `purchase.*`.
- Renderer: Suppliers page (search, owed-only, deactivate, delete only with no purchase history) and Purchases page
  (summary, filters, draft form with a line editor and live totals, detail with receive, cancel, payments).
- Not here: purchase orders sent to suppliers, partial receiving, reversing or returning a received purchase (use a
  stock count), supplier credit notes and advances, due dates and terms, weighted-average cost, reports (now Phase 17).
  Cash supplier payments reach the cash drawer in Phase 15.

## Expenses and cash (Phase 15)

- Tables: `expense_categories`, `expenses`, `cash_entries` (migration `0013`). Money is integer paise. Expense
  numbers come from the numbering service (`PREFIX-EXP-000001`).
- Expenses: a category, an amount, how it was paid (cash, UPI, bank, card, cheque, other), payee, reference, notes
  and the time it was spent (never in the future). An expense can be corrected while it stands (audited with the
  old and new amount); a wrong one is voided with a reason and stays on record. Triggers forbid deleting an
  expense, changing its number or author, changing a voided expense and voiding it twice. Categories are unique by
  name (case-insensitive), can be deactivated, and are deleted only when no expense uses them.
- Cash drawer: nothing is copied into a ledger. The cash book reads cash from where it was recorded: bill payments
  by cash (in), cash refund lines, cash expenses and cash supplier payments (out), plus `cash_entries` kept by hand
  (opening float and cash added in; bank deposits, owner withdrawals and other cash removed out). Voided expenses,
  supplier payments and entries never count. A cash entry cannot be edited or deleted, only voided once.
- Balances: the book for a range of days shows the opening balance (everything before the first day), each
  movement oldest first, totals and the closing balance. The summary gives the balance now and today's movement.
  A "day" is the local day of the machine, as on the till. The balance can go negative; it is flagged, not blocked.
- Permissions: `expenses.view|operate|manage` (manage includes operate) and `cash.view|manage`. Channels
  `expense-categories:*`, `expenses:*` and `cash:*`; audit actions `expense_category.*`, `expense.*` and `cash.*`.
- Renderer: Expenses page (month summary by category and method, filters, table, add, edit, void, category
  management) and Cash drawer page (balance, today's movement, cash book with opening and closing balance, record
  and void drawer entries).
- Not here: recurring expenses, receipts or attachments, expense approval, a bank book for non-cash methods,
  reports (now Phase 17).

## Day closing (Phase 16)

- Table `day_closings` (migration 0014): one row per closing, with the frozen day summary (JSON), expected cash,
  counted cash, variance, the note and coin count, and who closed and reopened it. Triggers stop any change to the
  figures, allow a reopen only once and block deletes. A partial unique index allows one standing closing per
  business date. Closings are numbered like `TK-DAY-000001`.
- Days are machine-local calendar days (`YYYY-MM-DD`). A day's summary reads settled bills (sales, discounts, tax,
  by order type), payments by method, refunds, expenses, supplier payments and the cash book.
- Closing needs every order created by the end of that day to be settled or cancelled. The counted cash is compared
  with the book; any difference needs a note and is booked as a `COUNT_SHORT` or `COUNT_EXCESS` drawer entry
  dated inside the closed day, so the drawer balance equals the cash counted from then on. Those two kinds cannot be
  recorded by hand.
- `DayLock` guards the services: once a day is closed, new orders, payments, refunds, expenses, drawer entries and
  supplier payments (and changes or voids of those dated in the day) fail with `CONFLICT`. Only the latest closed day
  can be reopened; reopening needs a reason, voids the count entry and lifts the lock, and the old closing stays on
  record. Closing again makes a new closing number.
- Overview lists earlier days (31-day look-back) that had money activity but were never closed.
- Permissions `day.view`, `day.close` and `day.reopen` (close and reopen imply view); channels `day:*`; audit
  actions `day.closed` and `day.reopened`.
- Renderer: Day closing page (date picker, unclosed-day banner, summary, blockers, count-by-note dialog with a live
  difference, closed card, reopen, history).
- Not here: shift or cashier-level closing, a drawer per user, a printed day report (Phase 18), a sales-vs-closing reconciliation report,
  bank, UPI and card reconciliation. The lock is enforced in services, not by database triggers.

## Reporting (Phase 17)

- No table or migration: reports are read-only queries over the live tables. Each report is worked out in the main
  process (`electron/main/reports/`) and returned as a ready-made table (`ReportResult`: columns, rows, a totals row
  and a short summary). The screen, the CSV, the PDF and the printed page all draw the same result, so they cannot
  disagree.
- Seventeen reports in four groups. Sales: sales, daily, monthly, item, category, payment, tax, discount and staff.
  Kitchen and cancellations: KOT, cancelled orders, cancelled bills. Stock and purchasing: inventory, purchases,
  suppliers. Money: expenses and day closings. Each report lists the filters it understands (`REPORTS` in
  `shared/reports.ts`); a filter a report does not use is ignored, and a value it does not offer (a method or status
  outside its list) is refused with `VALIDATION_ERROR`.
- Dates are machine-local calendar days, both ends included. A range may cover at most 1830 days and a report keeps at
  most 10000 rows; a longer one is cut and says so. Money is paise, quantities thousandths and percentages basis
  points in the result; only the formatters turn them into rupees and decimals.
- Sales figures count settled bills by their settlement time, so unpaid and cancelled bills never appear; refunds are
  taken off the net. Item sales share a bill's discount across its items. Inventory shows stock now plus movement
  inside the period. Purchases default to received ones; a status picks drafts or cancelled ones.
- CSV: UTF-8 with a BOM, plain decimals for money, quantities and percentages (so they add up in a spreadsheet),
  and text that could run as a formula is prefixed with a quote. PDF and print draw an HTML page in a hidden window;
  save and print go through a `ReportOutput` interface, so the Electron dialogs are the only untested part.
- Permissions `reports.view` and `reports.export` (export implies view); channels `reports:*`; audit action
  `report.exported` (CSV, PDF or print, with the kind and dates). A cancelled save is not recorded.
- Renderer: Reports page (report list by group, dates and filters, summary cards, table with totals and paging of
  200 rows, CSV, PDF and Print buttons for those who may export).
- Not here: scheduled or emailed reports, saved filters, charts, comparison with an earlier period, profit and loss,
  GST return formats, a stock valuation as of a past date, and the printer-driven (thermal) report print (Phase 18).

## Touch screen and mouse

The product is delivered on Windows terminals with a touch screen and a mouse, so every screen works with
both.

- Tailwind has a `touch` variant (`any-pointer: coarse`). On a terminal with a touch screen, buttons,
  inputs, selects, quantity steppers, filter pills and tick boxes grow to finger size (44 to 56 px high)
  whichever pointer is in use; on a mouse-only machine they stay compact.
- No interaction depends on hover. Text selection, double-tap zoom, the tap delay and pull-to-scroll bounce
  are switched off in the global CSS, and the window refuses pinch zoom.
- Amount fields in the payment and discount dialogs use an on-screen number pad (`NumPad`, `applyPadKey`)
  and `inputMode="none"`, so the Windows touch keyboard does not cover the dialog; a physical keyboard still
  types into them. The payment dialog also offers "Exact amount" and quick cash notes for change.
- Other text fields use the system touch keyboard, which Windows shows when a text field is tapped.

## Logging

Channels `app`, `security`, `sync`, `printer`, `database` -> JSON lines, daily files, redaction of sensitive keys, 30-day retention. Renderer logs go through IPC with a flood limit.

## Phase plan

| #   | Phase                                                                                                                                                     | Outcome                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Foundation (done)                                                                                                                                         | Shell, IPC, SQLite, migrations, logging, health, tests        |
| 2   | Authentication and restaurant setup (done)                                                                                                                | First-run setup, users, roles, password login, permissions    |
| 3   | Areas and tables (done)                                                                                                                                   | Table CRUD, table view with live status                       |
| 4   | Menu management (done)                                                                                                                                    | Categories, items, variants, add-ons, taxes                   |
| 5   | Ordering (done)                                                                                                                                           | Dine-in / takeaway / delivery orders, cart, hold              |
| 6   | KOT and printing (done)                                                                                                                                   | Per-station KOTs, printer abstraction, preview fallback       |
| 8   | Billing and payments (done)                                                                                                                               | Bills, discounts, split, payment modes, settlement            |
| 9   | Payment and receipt (done)                                                                                                                                | 58/80 mm receipts, reprint audit, refunds                     |
| 10  | Advanced table operations (done)                                                                                                                          | Shift table, merge tables, operation records                  |
| 11  | Takeaway, pickup and delivery (done)                                                                                                                      | Promised time, rider dispatch, delivery and packaging charges |
| 12  | Customers and reservations (done)                                                                                                                         | Customer records, phone lookup, bookings, seating             |
| 13  | Inventory and recipes (done)                                                                                                                              | Stock items, ledger, recipes, auto-deduction on KOT           |
| 14  | Purchasing and suppliers (done)                                                                                                                           | Suppliers, purchase drafts, receiving into stock, payments    |
| 15  | Expenses and cash (done)                                                                                                                                  | Expense categories, expenses, cash drawer and cash book       |
| 16  | Day closing (done)                                                                                                                                        | Day summary, cash count, closing and reopening, day lock      |
| 17  | Reporting (done)                                                                                                                                          | 17 reports, filters, CSV, PDF and print export                |
| 8+  | Printing, inventory, purchases, customers, reservations, shifts/cash drawer, LAN sync, cloud backend and sync, backup/restore, installers and auto-update | Per the product spec                                          |

Each phase ships working, tested software with a written report; no phase starts until the previous one passes tests.
