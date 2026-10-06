# Tandoori-POS

Offline-first restaurant POS and management desktop app for **TANDOORI BITES**, Rampura Phul, Punjab.

Current status: **Phase 5 – Order management** complete (Phases 1 Foundation, 2 Authentication, 3 Table and area management and 4 Menu management before it). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture and the phase plan.

## Requirements

- Node.js 20+ (developed on Node 24 runtime bundled with Electron 44)
- npm 10+
- Linux, Windows or macOS with a C/C++ toolchain only if prebuilt `better-sqlite3` binaries are unavailable

## Setup

```bash
npm install        # also rebuilds native modules (better-sqlite3) for Electron
```

## Commands

| Command                             | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                       | Start the app with hot reload (development environment)    |
| `npm run dev:staging`               | Start with `.env.staging`                                  |
| `npm run build`                     | Typecheck, then build main, preload and renderer to `out/` |
| `npm run start`                     | Preview the production build (uses the `app://` protocol)  |
| `npm test`                          | Run unit/integration tests (Vitest under Electron's Node)  |
| `npm run typecheck`                 | TypeScript strict check for main and renderer              |
| `npm run lint` / `npm run lint:fix` | ESLint                                                     |
| `npm run format` / `format:check`   | Prettier                                                   |
| `npm run db:generate`               | Generate a Drizzle migration after editing the schema      |
| `npm run db:check`                  | Validate migration consistency                             |

Tests run with `ELECTRON_RUN_AS_NODE=1` so native modules load with the same ABI as the app.

## Environments

`.env.development`, `.env.staging`, `.env.production` – only `MAIN_VITE_*` variables are read, and only by the main process.

| Variable                  | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `MAIN_VITE_APP_ENV`       | `development` / `staging` / `production`                                  |
| `MAIN_VITE_LOG_LEVEL`     | `debug` / `info` / `warn` / `error`                                       |
| `MAIN_VITE_CLOUD_API_URL` | Cloud API base URL (used from the cloud-sync phase); empty = purely local |

Never put secrets in these files. Development only: `TANDOORI_USER_DATA_DIR=/some/dir npm run dev` runs against a throwaway data folder. For a built app use `npx electron-vite build --mode development` first; `npm run build` is a production build and ignores the override.

## Installers (Windows and Linux)

```
npm run package:linux   # release/Tandoori-POS-<version>-x86_64.AppImage and ...-amd64.deb
npm run package:win     # release/Tandoori-POS-Setup-<version>.exe (Next, Next, Install wizard)
```

Build the Windows installer on a Windows PC (or with Wine installed on Linux), or let the
`Build installers` GitHub Actions workflow produce both from a pushed repository. The installed
app keeps its data per user (Windows: `%APPDATA%\Tandoori-POS`, Linux: `~/.config/Tandoori-POS`),
so updating or uninstalling does not delete restaurant data.

## Forgot the sign-in on a development machine

There is no default account. Move the local data folder aside and the setup wizard appears again:
`mv ~/.config/Tandoori-POS/data ~/.config/Tandoori-POS/data.old` (Linux). The old data stays in
`data.old`.

## First run and sign-in

On first launch the app shows a setup wizard: restaurant details, owner account,
password, confirmation. Everything is written in one transaction (restaurant,
OWNER role, permissions, owner account) and then the sign-in screen appears.
Sign-in works fully offline: accounts and passwords live in the local database.

- Passwords are hashed with scrypt (random salt per user); plaintext is never stored or logged.
- The session handle lives only in the main process; the renderer holds no credential.
- Sessions end after 30 minutes idle or 12 hours absolute, and do not survive an app restart.
- 5 wrong passwords within 5 minutes lock the account for a short time.
- Permissions are re-read from the database on every protected call, so a role change or
  deactivation takes effect immediately.
- Login, logout, failed login, permission denials, staff/role/restaurant changes are audited.
- Staff created or reset by an admin must choose their own password at first sign-in.

## Where data lives

Under Electron's `userData` folder (for example `~/.config/Tandoori-POS` on Linux):

- `data/tandoori-pos.db` – SQLite database (WAL mode, foreign keys on)
- `logs/<channel>-YYYY-MM-DD.log` – JSON lines for `app`, `security`, `sync`, `printer`, `database` (30-day retention, sensitive keys redacted)
- `backups/` – reserved for the backup phase
- `config.json` – window/user preferences

## Project layout

```
electron/
  main/        Electron main process (window, IPC, DB, logging, security, health)
  preload/     contextBridge API exposed as window.tandoori
  shared/      IPC channel names, types and zod schemas shared with the renderer
src/           React renderer (layouts, pages, modules, stores, services)
drizzle/       SQL migrations generated by drizzle-kit
tests/main/    Main-process tests
```

## Security model

- `contextIsolation`, `sandbox`, no `nodeIntegration`, no `webview`, permissions denied
- Navigation and `window.open` blocked; production loads from a privileged `app://tandoori-pos/` protocol with a strict CSP
- Every IPC call validates the sender (main frame, trusted origin, known window) and its input (zod)
- Errors reach the UI as a friendly message plus a short request id; technical detail goes to the log only

## Troubleshooting

- **`better-sqlite3` ABI / `NODE_MODULE_VERSION` error**: run `npx electron-builder install-app-deps`.
- **Linux `chrome-sandbox` SUID error**: fix the sandbox permissions, or for development only run `npx electron-vite dev -- --no-sandbox`.
- **Startup screen shows a database error**: open `logs/database-*.log` in the data folder; the app will not touch a database it cannot migrate.
