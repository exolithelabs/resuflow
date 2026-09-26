import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceError } from './workspace.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(appRoot, 'bin', 'resuflow.mjs');

export function appPaths() {
  return { appRoot, cliPath };
}

export async function launchDesktop({ workspaceRoot, port }) {
  const binary = await findDesktopBinary();
  if (!binary) {
    throw new WorkspaceError(
      'Desktop shell is not built yet. Run `npm run desktop:build`, or use `resuflow --browser` to open in a browser.',
    );
  }

  console.log('ResuFlow (desktop)');
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Web UI:    http://127.0.0.1:${port}/  (also available in a browser)`);
  console.log(`Window:    ${binary}`);

  const child = spawn(binary, [], {
    env: {
      ...process.env,
      RESUFLOW_WORKSPACE: workspaceRoot,
      RESUFLOW_CLI: cliPath,
      RESUFLOW_NODE: process.execPath,
      RESUFLOW_PORT: String(port),
      RESUFLOW_APP_ROOT: appRoot,
    },
    stdio: 'inherit',
    windowsHide: false,
  });

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || code === null) resolve();
      else reject(new WorkspaceError(`Desktop app exited (${signal || code})`));
    });
  });
}

async function findDesktopBinary() {
  const exe = process.platform === 'win32' ? 'resuflow.exe' : 'resuflow';
  const candidates = [
    process.env.RESUFLOW_DESKTOP,
    path.join(appRoot, 'desktop', exe),
    path.join(appRoot, 'src-tauri', 'target', 'release', exe),
    path.join(appRoot, 'src-tauri', 'target', 'debug', exe),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
