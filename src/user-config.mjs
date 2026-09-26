import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, access } from 'node:fs/promises';
import { atomicWriteFile } from './atomic-write.mjs';

const CONFIG_DIR = '.resuflow';
const LEGACY_CONFIG_DIR = '.resume-builder';

export function userConfigPath() {
  return path.join(homedir(), CONFIG_DIR, 'config.json');
}

export function legacyUserConfigPath() {
  return path.join(homedir(), LEGACY_CONFIG_DIR, 'config.json');
}

export async function loadUserConfig() {
  for (const file of [userConfigPath(), legacyUserConfigPath()]) {
    try {
      const payload = JSON.parse(await readFile(file, 'utf8'));
      return {
        defaultVault: String(payload.defaultVault || ''),
        recentVaults: Array.isArray(payload.recentVaults) ? payload.recentVaults.map(String) : [],
      };
    } catch {
      // Optional file: fall through to the legacy location, then to the defaults.
    }
  }
  return { defaultVault: '', recentVaults: [] };
}

export async function saveUserConfig(input) {
  const current = await loadUserConfig();
  const next = {
    defaultVault: input.defaultVault !== undefined ? String(input.defaultVault || '') : current.defaultVault,
    recentVaults: Array.isArray(input.recentVaults) ? input.recentVaults.map(String) : current.recentVaults,
  };
  const file = userConfigPath();
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function rememberVault(root, { setDefault = true } = {}) {
  const resolved = path.resolve(root);
  const current = await loadUserConfig();
  const recent = [resolved, ...current.recentVaults.filter((item) => item !== resolved)].slice(0, 8);
  return saveUserConfig({
    defaultVault: setDefault ? resolved : current.defaultVault || resolved,
    recentVaults: recent,
  });
}

export async function pathExists(dir) {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}
