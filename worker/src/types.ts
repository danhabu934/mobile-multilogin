export type ProxyConfig = { type: 'none' | 'http' | 'https' | 'socks5'; host?: string; port?: number; username?: string; password?: string }
export type ProfileStatus = 'created' | 'starting' | 'running' | 'stopped' | 'error'
export type Engine = 'android-emulator' | 'bluestacks' | 'physical'
export type DeviceSettings = {
  memoryMb: number; cores: number; heapMb: number; resolution: string; density: number;
  gpu: 'auto' | 'host' | 'software' | 'swiftshader_indirect'; cameraFront: string; cameraBack: string;
}
export type AndroidProfile = {
  id: string; displayName: string; avdName: string; deviceId: string; systemImage: string;
  emulatorPort: number; proxy: ProxyConfig; status: ProfileStatus; pid?: number;
  createdAt: string; updatedAt: string; lastError?: string;
  engine?: Engine; group?: string; notes?: string; settings?: DeviceSettings;
  serial?: string; instanceName?: string; startedAt?: string;
}
export type CommandResult = { command: string; args: string[]; code: number; stdout: string; stderr: string }
