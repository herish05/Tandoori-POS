import type { TandooriApi } from '@shared/api'
import type { AppInfo, HealthReport, UserConfig, WindowState } from '@shared/types'
import { getApi, unwrap } from '@/lib/ipc'

/** Thin, typed wrapper over the preload API for application-level (non-business) capabilities. */
export const systemService = {
  getAppInfo: (): Promise<AppInfo> => unwrap(getApi().app.getInfo()),
  checkHealth: (): Promise<HealthReport> => unwrap(getApi().health.check()),
  getUserConfig: (): Promise<UserConfig> => unwrap(getApi().config.get()),
  updateUserConfig: (patch: Partial<UserConfig>): Promise<UserConfig> =>
    unwrap(getApi().config.update(patch)),
  getWindowState: (): Promise<WindowState> => unwrap(getApi().window.getState()),
  minimize: (): Promise<null> => unwrap(getApi().window.minimize()),
  toggleMaximize: (): Promise<WindowState> => unwrap(getApi().window.toggleMaximize()),
  toggleFullscreen: (): Promise<WindowState> => unwrap(getApi().window.toggleFullscreen()),
  close: (): Promise<null> => unwrap(getApi().window.close()),
  onWindowStateChanged: (listener: Parameters<TandooriApi['window']['onStateChanged']>[0]) =>
    getApi().window.onStateChanged(listener)
}
