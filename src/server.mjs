import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WorkspaceError,
  assertSlug,
  loadProfile,
  saveProfile,
  listResumes,
  loadResume,
  createResume,
  saveResume,
  deleteResume,
  SCHEMA_VERSION,
  findWorkspace,
  initWorkspace,
} from './workspace.mjs';
import { loadUserConfig, rememberVault } from './user-config.mjs';
import { renderResume } from './render.mjs';
import { pdfPaths, writeResumePdf } from './pdf.mjs';
import { listSkills, loadSkill, createSkill, saveSkill, deleteSkill, setSkillEnabled } from './skills-store.mjs';
import { loadMemory, saveMemory } from './memory.mjs';
import { handleMcpRequest, mcpSnippet } from './mcp.mjs';
import { openBrowser } from './browser.mjs';
import { checkLatestRelease, CURRENT_VERSION } from './releases.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(appRoot, 'web');
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};
const APP_CSP = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'self'; frame-src 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'";
const PREVIEW_CSP = "default-src 'none'; base-uri 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'";
const STATIC_FILES = new Map([
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
]);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.woff2', 'font/woff2'],
]);

export function startServer({
  workspaceRoot,
  port,
  apiToken: suppliedApiToken,
  launchToken: suppliedLaunchToken,
}) {
  const configuredToken = suppliedApiToken || process.env.RESUFLOW_API_TOKEN || '';
  if (configuredToken && !/^[A-Za-z0-9_-]{32,128}$/.test(configuredToken)) {
    throw new WorkspaceError('RESUFLOW_API_TOKEN must be a 32-128 character URL-safe token.');
  }
  const apiToken = configuredToken || randomBytes(32).toString('base64url');
  const browserSessionId = randomBytes(32).toString('base64url');
  const state = {
    workspaceRoot,
    launchToken: suppliedLaunchToken || process.env.RESUFLOW_LAUNCH_TOKEN || '',
    apiToken,
    browserSessionId,
  };
  const server = http.createServer((req, res) => {
    handle(req, res, state, port).catch((error) => {
      sendError(res, error);
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${port}/`,
        launchUrl: `http://127.0.0.1:${port}/?token=${encodeURIComponent(apiToken)}`,
        mcpUrl: `http://127.0.0.1:${port}/mcp`,
        apiToken,
      });
    });
  });
}

async function handle(req, res, state, port) {
  const workspaceRoot = state.workspaceRoot;
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const method = req.method || 'GET';
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    throw new WorkspaceError('Invalid URL encoding.');
  }

  assertTrustedHost(req, port);
  const protectedPath = pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/preview/');
  if (protectedPath) assertTrustedOrigin(req, port);

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, {
      ok: true,
      app: 'resuflow',
      launchToken: state.launchToken,
    });
  }

  if (protectedPath && method !== 'OPTIONS') {
    const browserPath = pathname.startsWith('/api/') || pathname.startsWith('/preview/');
    authorizeRequest(req, state.apiToken, {
      allowCookie: browserPath,
      browserSessionId: state.browserSessionId,
      requireBrowserHeader: browserPath && method !== 'GET' && method !== 'HEAD',
    });
  }

  if (pathname === '/api/releases/latest' && method === 'GET') {
    try {
      return sendJson(res, await checkLatestRelease({
        useCache: requestUrl.searchParams.get('refresh') !== '1',
      }));
    } catch (error) {
      console.warn(`Release check unavailable: ${error.message}`);
      return sendJson(res, {
        checked: false,
        available: false,
        currentVersion: CURRENT_VERSION,
      });
    }
  }

  if (pathname === '/api/open-browser' && method === 'POST') {
    const body = await readJson(req);
    const hash = typeof body.hash === 'string' && /^#\/[A-Za-z0-9_~./-]*$/.test(body.hash)
      ? body.hash
      : '';
    openBrowser(`http://127.0.0.1:${port}/?token=${encodeURIComponent(state.apiToken)}${hash}`);
    return sendJson(res, { ok: true });
  }

  if (pathname === '/api/workspace' && method === 'GET') {
    const config = await loadUserConfig();
    return sendJson(res, {
      root: workspaceRoot,
      name: path.basename(workspaceRoot),
      schemaVersion: SCHEMA_VERSION,
      defaultVault: config.defaultVault || workspaceRoot,
      recentVaults: config.recentVaults || [],
    });
  }

  if (pathname === '/api/workspace' && method === 'PUT') {
    const body = await readJson(req);
    const target = String(body.root || '').trim();
    if (!target) throw new WorkspaceError('A vault path is required.');
    const workspace = body.init
      ? await initWorkspace(target)
      : await findWorkspace(target);
    state.workspaceRoot = workspace.root;
    const config = await rememberVault(workspace.root, { setDefault: body.setDefault !== false });
    return sendJson(res, {
      root: workspace.root,
      name: path.basename(workspace.root),
      schemaVersion: SCHEMA_VERSION,
      defaultVault: config.defaultVault,
      recentVaults: config.recentVaults,
    });
  }

  if (pathname === '/api/profile' && method === 'GET') {
    return sendJson(res, await loadProfile(workspaceRoot));
  }

  if (pathname === '/api/profile' && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, await saveProfile(workspaceRoot, body));
  }

  if (pathname === '/api/mcp' && method === 'GET') {
    return sendJson(res, mcpSnippet(`http://127.0.0.1:${port}/mcp`, state.apiToken));
  }

  if (pathname === '/mcp' && method === 'OPTIONS') {
    const origin = req.headers.origin;
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, x-resuflow-token',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  if (pathname === '/mcp') {
    const body = method === 'POST' ? await readJson(req) : undefined;
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    return handleMcpRequest(req, res, body, workspaceRoot);
  }

  if (pathname === '/api/memory' && method === 'GET') {
    return sendJson(res, await loadMemory(workspaceRoot));
  }

  if (pathname === '/api/memory' && method === 'PUT') {
    const body = await readJson(req);
    return sendJson(res, await saveMemory(workspaceRoot, body));
  }

  if (pathname === '/api/skills' && method === 'GET') {
    return sendJson(res, { skills: await listSkills(workspaceRoot) });
  }

  if (pathname === '/api/skills' && method === 'POST') {
    const body = await readJson(req);
    res.statusCode = 201;
    return sendJson(res, await createSkill(workspaceRoot, body));
  }

  const skillEnabledMatch = pathname.match(/^\/api\/skills\/([^/]+)\/enabled$/);
  if ((pathname === '/api/skill/enabled' || skillEnabledMatch) && method === 'PUT') {
    const slug = pathname === '/api/skill/enabled'
      ? requestSlug(req, 'skill')
      : decodeURIComponent(skillEnabledMatch[1]);
    const body = await readJson(req);
    return sendJson(res, await setSkillEnabled(workspaceRoot, slug, body.enabled !== false));
  }

  const skillMatch = pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (pathname === '/api/skill' || skillMatch) {
    const slug = pathname === '/api/skill'
      ? requestSlug(req, 'skill')
      : decodeURIComponent(skillMatch[1]);
    if (method === 'GET') return sendJson(res, await loadSkill(workspaceRoot, slug));
    if (method === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, await saveSkill(workspaceRoot, slug, body));
    }
    if (method === 'DELETE') {
      await deleteSkill(workspaceRoot, slug);
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  if (pathname === '/api/resumes' && method === 'GET') {
    return sendJson(res, { resumes: await listResumes(workspaceRoot) });
  }

  if (pathname === '/api/resumes' && method === 'POST') {
    const body = await readJson(req);
    res.statusCode = 201;
    return sendJson(res, await createResume(workspaceRoot, body));
  }

  const resumeMatch = pathname.match(/^\/api\/resumes\/([^/]+)(?:\/(pdf))?$/);
  if (pathname === '/api/resume' || pathname === '/api/resume/pdf' || resumeMatch) {
    const slug = pathname === '/api/resume' || pathname === '/api/resume/pdf'
      ? requestSlug(req, 'resume')
      : decodeURIComponent(resumeMatch[1]);
    const pdf = pathname === '/api/resume/pdf' || resumeMatch?.[2] === 'pdf';

    if (pdf && method === 'POST') {
      const profile = await loadProfile(workspaceRoot);
      const resume = await loadResume(workspaceRoot, slug);
      const html = renderResume(profile, resume);
      const outFile = await writeResumePdf(workspaceRoot, slug, html);
      return sendJson(res, { ok: true, path: outFile });
    }

    if (pdf && method === 'GET') {
      const file = pdfPaths(workspaceRoot, slug).resumePdf;
      return sendFile(res, file, { downloadName: `${slug}.pdf` });
    }

    if (method === 'GET') return sendJson(res, await loadResume(workspaceRoot, slug));
    if (method === 'PUT') {
      const body = await readJson(req);
      return sendJson(res, await saveResume(workspaceRoot, slug, body));
    }
    if (method === 'DELETE') {
      await deleteResume(workspaceRoot, slug);
      res.statusCode = 204;
      res.end();
      return;
    }
  }

  const previewMatch = pathname.match(/^\/preview\/([^/]+)\/?$/);
  if (previewMatch && method === 'GET') {
    const slug = decodeURIComponent(previewMatch[1]);
    const profile = await loadProfile(workspaceRoot);
    const resume = await loadResume(workspaceRoot, slug);
    return sendHtml(res, renderResume(profile, resume), { csp: PREVIEW_CSP });
  }

  if (method === 'GET') {
    return sendStatic(req, res, pathname, requestUrl, state.apiToken, state.browserSessionId);
  }

  throw new WorkspaceError('Not found', 404);
}

async function sendStatic(req, res, pathname, requestUrl, apiToken, browserSessionId) {
  if (pathname.includes('\\') || pathname.split('/').includes('..')) {
    throw new WorkspaceError('Forbidden', 403);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendIndex(req, res, requestUrl, apiToken, browserSessionId);
  }

  const staticName = STATIC_FILES.get(pathname);
  if (!staticName) throw new WorkspaceError('Not found', 404);
  const filePath = path.join(webDir, staticName);
  const contents = await readFile(filePath);
  const type = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Security-Policy': APP_CSP, 'Content-Type': type });
  res.end(contents);
}

async function sendIndex(req, res, requestUrl, apiToken, browserSessionId) {
  const suppliedToken = requestUrl.searchParams.get('token');
  if (suppliedToken !== null) {
    if (!tokensMatch(suppliedToken, apiToken)) throw new WorkspaceError('Invalid launch token.', 403);
    const redirectUrl = new URL(requestUrl.pathname, 'http://127.0.0.1');
    for (const [key, value] of requestUrl.searchParams) {
      if (key !== 'token') redirectUrl.searchParams.append(key, value);
    }
    res.writeHead(302, {
      ...SECURITY_HEADERS,
      Location: `${redirectUrl.pathname}${redirectUrl.search}`,
      'Set-Cookie': sessionCookie(browserSessionId),
    });
    res.end();
    return;
  }

  if (!tokensMatch(readCookie(req, 'rf_session'), browserSessionId)) {
    res.writeHead(401, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ResuFlow must be opened from the desktop app or CLI launch URL.');
    return;
  }

  const html = await readFile(path.join(webDir, 'index.html'), 'utf8');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': APP_CSP,
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': sessionCookie(browserSessionId),
  });
  res.end(html);
}

async function sendFile(res, filePath, { downloadName } = {}) {
  try {
    const contents = await readFile(filePath);
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/pdf',
    };
    if (downloadName) {
      headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
    }
    res.writeHead(200, headers);
    res.end(contents);
  } catch {
    throw new WorkspaceError('PDF not generated yet. Export it first.', 404);
  }
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(res.statusCode || 200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html, { csp = APP_CSP } = {}) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': csp,
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end(html);
}

function sendError(res, error) {
  const status = error instanceof WorkspaceError ? error.status : 500;
  const message = error instanceof WorkspaceError ? error.message : 'Internal server error';
  if (status >= 500) console.error(error);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: message }));
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new WorkspaceError('Content-Type must be application/json.', 415);
  }
  const announcedLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(announcedLength) && announcedLength > MAX_JSON_BODY_BYTES) {
    throw new WorkspaceError('Request body is too large.', 413);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_JSON_BODY_BYTES) {
      throw new WorkspaceError('Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new WorkspaceError('Invalid JSON body');
  }
}

function assertTrustedHost(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    throw new WorkspaceError('Untrusted host.', 403);
  }
}

function assertTrustedOrigin(req, port) {
  const origin = req.headers.origin;
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (origin && !allowed.has(origin)) throw new WorkspaceError('Cross-origin requests are not allowed.', 403);
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new WorkspaceError('Cross-site requests are not allowed.', 403);
  }
}

function requestSlug(req, kind) {
  const slug = String(req.headers['x-resuflow-slug'] || '');
  assertSlug(slug, kind);
  return slug;
}

function authorizeRequest(req, apiToken, {
  allowCookie = false,
  browserSessionId = '',
  requireBrowserHeader = false,
} = {}) {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const headerToken = String(req.headers['x-resuflow-token'] || bearer);
  if (tokensMatch(headerToken, apiToken)) return;
  if (allowCookie && tokensMatch(readCookie(req, 'rf_session'), browserSessionId)) {
    if (requireBrowserHeader && req.headers['x-resuflow-request'] !== '1') {
      throw new WorkspaceError('Browser request header required.', 403);
    }
    return;
  }
  throw new WorkspaceError('Authentication required.', 401);
}

function tokensMatch(candidate, expected) {
  if (!candidate || !expected) return false;
  const left = Buffer.from(String(candidate));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index === -1) continue;
    if (cookie.slice(0, index).trim() === name) return cookie.slice(index + 1).trim();
  }
  return '';
}

function sessionCookie(browserSessionId) {
  return `rf_session=${browserSessionId}; HttpOnly; SameSite=Strict; Path=/`;
}
