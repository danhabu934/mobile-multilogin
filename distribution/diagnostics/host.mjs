import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
const GiB = 1024 ** 3;
export function classify({total, free, cores, arch}) {
  const supported = ['x64', 'arm64'].includes(arch);
  return {
    supported,
    tier: !supported || total < 8 * GiB || cores < 4 ? 'Abaixo do recomendado' : total < 16 * GiB ? 'Básico' : total < 32 * GiB ? 'Recomendado' : 'Alto desempenho',
    availableGiB: Math.round(free / GiB * 10) / 10,
    note: 'Classificação indicativa. Não comprova compatibilidade de aplicativos nem quantidade de perfis simultâneos.'
  };
}
async function probe(command, args) {
  try {
    const result = await exec(command, args, {timeout: 12000, maxBuffer: 128 * 1024, windowsHide: true});
    return {status: 'ok', detail: `${result.stdout}\n${result.stderr}`.trim().slice(0, 2000)};
  } catch (error) {
    return {status: 'unavailable', detail: error.code === 'ENOENT' ? 'Não encontrado neste ambiente.' : 'Não foi possível confirmar. Verifique a instalação e as permissões.'};
  }
}
export async function inspectHost() {
  const platform = os.platform();
  const arch = os.arch();
  const total = os.totalmem();
  const free = os.freemem();
  const cores = os.cpus().length;
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || (platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Android', 'Sdk') : platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk') : path.join(os.homedir(), 'Android', 'Sdk'));
  const suffix = platform === 'win32' ? '.exe' : '';
  const [java, adb, acceleration] = await Promise.all([
    probe('java', ['-version']),
    probe(path.join(sdk, 'platform-tools', `adb${suffix}`), ['version']),
    probe(path.join(sdk, 'emulator', `emulator${suffix}`), ['-accel-check'])
  ]);
  let sdkPresent = false;
  try { sdkPresent = (await fs.stat(sdk)).isDirectory(); } catch {}
  let diskFreeGiB = null;
  try { const s = await fs.statfs(os.homedir()); diskFreeGiB = Math.floor(s.bavail * s.bsize / GiB); } catch {}
  return {
    timestamp: new Date().toISOString(), platform, arch,
    cpu: os.cpus()[0]?.model || 'Não identificado', cores,
    totalGiB: Math.round(total / GiB * 10) / 10,
    freeGiB: Math.round(free / GiB * 10) / 10, diskFreeGiB,
    runtime: process.versions.node,
    runtimeNote: 'Runtime interno do diagnóstico; não confirma Node instalado no sistema.',
    sdk: {status: sdkPresent ? 'found' : 'unavailable', detail: sdkPresent ? 'Diretório encontrado; componentes verificados separadamente.' : 'Diretório padrão não encontrado.'},
    java, adb, acceleration,
    assessment: classify({total, free, cores, arch}),
    worker: {status: 'not_checked', detail: 'Esta edição independente não inicia nem consulta o worker.'}
  };
}
