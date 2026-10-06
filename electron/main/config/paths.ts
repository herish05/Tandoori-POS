import { join } from 'node:path'

export interface AppPaths {
  userData: string
  data: string
  logs: string
  backups: string
  database: string
  userConfig: string
  migrations: string
}

/** Pure path layout so it can be unit tested without Electron. */
export function resolveAppPaths(userDataDir: string, migrationsDir: string): AppPaths {
  const data = join(userDataDir, 'data')
  return {
    userData: userDataDir,
    data,
    logs: join(userDataDir, 'logs'),
    backups: join(userDataDir, 'backups'),
    database: join(data, 'tandoori-pos.db'),
    userConfig: join(userDataDir, 'config.json'),
    migrations: migrationsDir
  }
}
