export type ProxyConfig = {
  type: 'none' | 'http' | 'https' | 'socks5'
  host?: string
  port?: number
  username?: string
  password?: string
}

export type ProfileStatus = 'created' | 'starting' | 'running' | 'stopped' | 'error'

export type AndroidProfile = {
  id: string
  displayName: string
  avdName: string
  deviceId: string
  systemImage: string
  emulatorPort: number
  proxy: ProxyConfig
  status: ProfileStatus
  pid?: number
  createdAt: string
  updatedAt: string
  lastError?: string
}

export type CommandResult = {
  command: string
  args: string[]
  code: number
  stdout: string
  stderr: string
}
