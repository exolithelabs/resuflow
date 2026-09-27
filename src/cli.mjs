import path from 'node:path';
import { homedir } from 'node:os';
import { initWorkspace, findWorkspace, listResumes, loadProfile, loadResume, WorkspaceError } from './workspace.mjs';
import { loadUserConfig, rememberVault } from './user-config.mjs';
import { startServer } from './server.mjs';
import { renderResume } from './render.mjs';
import { writeResumePdf } from './pdf.mjs';
import { launchDesktop } from './desktop.mjs';
import { installApp, uninstallApp, updateApp } from './lifecycle.mjs';
import { openBrowser } from './browser.mjs';

try {
  const args = parseArgs(process.argv.slice(2));
  const createDefaultWorkspace = args.sidecar || process.env.RESUFLOW_PACKAGED === '1';

  if (args.help || args.command === 'help') {
    printHelp();
    process.exit(0);
  }

  if (args.command === 'install') {
    process.exit(installApp());
  }

  if (args.command === 'update') {
    process.exit(updateApp());
  }

  if (args.command === 'uninstall') {
    process.exit(uninstallApp());
  }

  if (args.command === 'init') {
    const target = args.dir || process.cwd();
    const workspace = await initWorkspace(target);
    await rememberVault(workspace.root);
    console.log(`Workspace ready: ${workspace.root}`);
    console.log('This is now the default vault. Next: resuflow');
    process.exit(0);
  }

  if (args.command === 'desktop' || args.command === 'run') {
    const workspace = await resolveWorkspace(args.dir, { createDefault: createDefaultWorkspace });
    try {
      await launchDesktop({ workspaceRoot: workspace.root, port: args.port });
    } catch (error) {
      if (args.browserFallback === false) throw error;
      console.warn(error.message);
      console.warn('Opening in the browser instead.');
      try {
        await serveWorkspace(workspace, args.port, true);
      } catch (serveError) {
        if (String(serveError.message || serveError).includes('EADDRINUSE')) {
          throw new WorkspaceError(
            `Port ${args.port} is already in use. Refusing to open an unverified local service; choose another port with --port.`,
          );
        } else {
          throw serveError;
        }
      }
    }
  } else if (args.command === 'serve') {
    const workspace = await resolveWorkspace(args.dir, { createDefault: createDefaultWorkspace });
    await serveWorkspace(workspace, args.port, args.open);
  } else if (args.command === 'build') {
    const workspace = await resolveWorkspace(args.dir, { createDefault: createDefaultWorkspace });
    const profile = await loadProfile(workspace.root);
    const resumes = await listResumes(workspace.root);
    if (resumes.length === 0) {
      console.log('No resumes to build.');
      process.exit(0);
    }
    for (const item of resumes) {
      const resume = await loadResume(workspace.root, item.slug);
      const html = renderResume(profile, resume);
      const outFile = await writeResumePdf(workspace.root, item.slug, html);
      console.log(`Built ${item.slug} -> ${path.relative(workspace.root, outFile)}`);
    }
    process.exit(0);
  } else {
    throw new WorkspaceError(`Unknown command: ${args.command}`);
  }
} catch (error) {
  const message = error instanceof WorkspaceError ? error.message : error.stack || error.message;
  console.error(message);
  process.exit(1);
}

async function serveWorkspace(workspace, port, open) {
  const { url, launchUrl } = await startServer({
    workspaceRoot: workspace.root,
    port,
  });
  console.log('ResuFlow');
  console.log(`Workspace: ${workspace.root}`);
  console.log(`Web UI:    ${url}`);
  console.log(`MCP:       ${url.replace(/\/$/, '')}/mcp`);
  if (open) openBrowser(launchUrl);
  else console.log('Authentication: open with --browser, then copy the MCP configuration from Read docs.');
}

async function resolveWorkspace(dir, { createDefault = false } = {}) {
  if (dir) {
    const workspace = await findWorkspace(dir);
    await rememberVault(workspace.root);
    return workspace;
  }
  try {
    return await findWorkspace(process.cwd());
  } catch {
    const config = await loadUserConfig();
    if (config.defaultVault) return findWorkspace(config.defaultVault);
    if (createDefault) {
      const workspace = await initWorkspace(path.join(homedir(), 'Documents', 'ResuFlow'));
      await rememberVault(workspace.root);
      return workspace;
    }
    throw new WorkspaceError(
      'No vault found. Run `resuflow init <dir>` or set a default vault in the app (Settings → Vault).',
    );
  }
}

function parseArgs(argv) {
  const result = {
    command: 'desktop',
    dir: null,
    port: 4173,
    open: false,
    help: false,
    browserFallback: true,
    sidecar: false,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h' || token === '--help') {
      result.help = true;
    } else if (token === '--browser') {
      result.command = 'serve';
      result.open = true;
    } else if (token === '--sidecar') {
      result.command = 'serve';
      result.open = false;
      result.sidecar = true;
    } else if (token === '--no-open') {
      result.open = false;
    } else if (token === '--no-fallback') {
      result.browserFallback = false;
    } else if (token === '--port') {
      result.port = Number(argv[++i]);
    } else if (token.startsWith('--port=')) {
      result.port = Number(token.slice('--port='.length));
    } else if (token === '--dir') {
      result.dir = argv[++i];
    } else if (token.startsWith('--dir=')) {
      result.dir = token.slice('--dir='.length);
    } else if (token.startsWith('-')) {
      throw new WorkspaceError(`Unknown flag: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  const commands = new Set([
    'install',
    'update',
    'uninstall',
    'init',
    'run',
    'serve',
    'build',
    'help',
    'desktop',
  ]);
  if (positionals[0] && commands.has(positionals[0])) {
    result.command = positionals[0];
    if (!result.dir && positionals[1]) result.dir = positionals[1];
  } else if (positionals[0]) {
    result.dir = positionals[0];
  }

  if (result.command === 'serve' && argv.includes('--browser')) {
    result.open = true;
  }

  if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) {
    throw new WorkspaceError(`Invalid port: ${result.port}`);
  }

  return result;
}

function printHelp() {
  console.log(`ResuFlow — local web app for role-specific resumes

Install:
  Windows: download the installer from the product website.
  Linux (Arch): sudo pacman -U <release-url.pkg.tar.zst>, or download
  resuflow-linux-<arch>.pkg.tar.zst and run sudo pacman -U ./*.pkg.tar.zst
  from that folder. The same command upgrades an existing install.

Usage:
  resuflow [dir]               Run (desktop window by default)
  resuflow run [dir]           Same as the default
  resuflow desktop [dir]       Same as run
  resuflow --browser [dir]     Start the server and open a web browser
  resuflow serve [dir]         Start the localhost server only
  resuflow init [dir]          Create a data workspace
  resuflow build [dir]         Generate PDFs for every resume
  resuflow --help

Options:
  --dir <path>     Workspace directory
  --port <number>  Port for the Web UI (default 4173)
  --browser        Open in a web browser instead of the desktop window
  --no-open        Do not open a browser (serve only)
  --sidecar        Used by the Tauri desktop shell to start Node

The desktop window and the browser both talk to http://127.0.0.1:4173/.
Use the supported update method for your platform. Uninstalling never removes resume workspaces.
`);
}
