import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderResume } from '../src/render.mjs';
import { normalizeLocalAppUrl } from '../src/browser.mjs';
import { startServer } from '../src/server.mjs';
import { loadSkill } from '../src/skills-store.mjs';
import { findWorkspace, initWorkspace, saveProfile } from '../src/workspace.mjs';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function requestStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end();
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'resuflow-security-'));
  await initWorkspace(root);
  const port = await availablePort();
  const started = await startServer({
    workspaceRoot: root,
    port,
    launchToken: 'desktop-sidecar-health-token',
  });
  return {
    ...started,
    root,
    close: async () => {
      await new Promise((resolve) => started.server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('localhost API requires a token and rejects cross-origin mutation', async () => {
  const app = await fixture();
  try {
    const unauthorized = await fetch(`${app.url}api/resumes`);
    assert.equal(unauthorized.status, 401);

    const untrustedHost = await requestStatus(`${app.url}api/resumes`, {
        Host: 'attacker.example',
        'X-ResuFlow-Token': app.apiToken,
    });
    assert.equal(untrustedHost, 403);

    const health = await fetch(`${app.url}api/health`);
    const healthPayload = await health.json();
    assert.equal(healthPayload.launchToken, 'desktop-sidecar-health-token');
    assert.notEqual(healthPayload.launchToken, app.apiToken);

    const crossOrigin = await fetch(`${app.url}api/resumes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Origin: 'https://attacker.example',
        'X-ResuFlow-Token': app.apiToken,
      },
      body: JSON.stringify({ title: 'Blocked request' }),
    });
    assert.equal(crossOrigin.status, 403);

    const crossOriginMcp = await fetch(`${app.url}mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${app.apiToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_resume', arguments: { title: 'Blocked MCP request' } },
      }),
    });
    assert.equal(crossOriginMcp.status, 403);

    const resumes = await fetch(`${app.url}api/resumes`, {
      headers: { 'X-ResuFlow-Token': app.apiToken },
    });
    assert.equal(resumes.status, 200);
    assert.deepEqual((await resumes.json()).resumes, []);
  } finally {
    await app.close();
  }
});

test('browser bootstrap exchanges its token for a strict session cookie', async () => {
  const app = await fixture();
  try {
    const bootstrap = await fetch(app.launchUrl, { redirect: 'manual' });
    assert.equal(bootstrap.status, 302);
    assert.equal(bootstrap.headers.get('location'), '/');
    const cookie = bootstrap.headers.get('set-cookie');
    assert.match(cookie, /rf_session=/);
    assert.doesNotMatch(cookie, new RegExp(app.apiToken));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const page = await fetch(app.url, { headers: { Cookie: cookie.split(';', 1)[0] } });
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), new RegExp(app.apiToken));

    const browserApi = await fetch(`${app.url}api/resumes`, {
      headers: { Cookie: cookie.split(';', 1)[0] },
    });
    assert.equal(browserApi.status, 200);

    const missingRequestMarker = await fetch(`${app.url}api/resumes`, {
      method: 'POST',
      headers: {
        Cookie: cookie.split(';', 1)[0],
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Blocked request' }),
    });
    assert.equal(missingRequestMarker.status, 403);

    const browserMutation = await fetch(`${app.url}api/resumes`, {
      method: 'POST',
      headers: {
        Cookie: cookie.split(';', 1)[0],
        'Content-Type': 'application/json',
        'X-ResuFlow-Request': '1',
      },
      body: JSON.stringify({ title: 'Browser request' }),
    });
    assert.equal(browserMutation.status, 201);

    const fixedResumeRoute = await fetch(`${app.url}api/resume`, {
      headers: {
        Cookie: cookie.split(';', 1)[0],
        'X-ResuFlow-Slug': 'browser-request',
      },
    });
    assert.equal(fixedResumeRoute.status, 200);
  } finally {
    await app.close();
  }
});

test('browser launcher accepts only local HTTP app URLs', () => {
  assert.equal(normalizeLocalAppUrl('http://127.0.0.1:4173/?token=value'), 'http://127.0.0.1:4173/?token=value');
  assert.equal(normalizeLocalAppUrl('http://localhost:4173/'), 'http://localhost:4173/');
  assert.throws(() => normalizeLocalAppUrl('https://example.com/'), /Only a local/);
  assert.throws(() => normalizeLocalAppUrl('file:///etc/passwd'), /Only a local/);
});

test('JSON endpoints reject the wrong content type and oversized bodies', async () => {
  const app = await fixture();
  try {
    const wrongType = await fetch(`${app.url}api/resumes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-ResuFlow-Token': app.apiToken,
      },
      body: JSON.stringify({ title: 'No' }),
    });
    assert.equal(wrongType.status, 415);

    const oversized = await fetch(`${app.url}api/resumes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ResuFlow-Token': app.apiToken,
      },
      body: JSON.stringify({ title: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await app.close();
  }
});

test('encoded traversal cannot escape static or skill directories', async () => {
  const app = await fixture();
  try {
    const staticTraversal = await fetch(`${app.url}..%2Fpackage.json`, { redirect: 'manual' });
    assert.equal(staticTraversal.status, 403);

    const skillTraversal = await fetch(`${app.url}api/skills/..%5Caudit-target`, {
      headers: { 'X-ResuFlow-Token': app.apiToken },
    });
    assert.equal(skillTraversal.status, 400);

    await assert.rejects(() => loadSkill(app.root, '..\\audit-target'), /Invalid skill slug/);
  } finally {
    await app.close();
  }
});

test('resume rendering removes scripts, event handlers, and unsafe URLs', () => {
  const html = renderResume(
    { name: 'Safe', links: [] },
    {
      title: 'Security test',
      body: '<script>globalThis.pwned=true</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(1))',
    },
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<img/i);
});

test('workspace markers migrate safely and reject future schemas', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resuflow-migration-'));
  try {
    await writeFile(path.join(root, 'resuflow.json'), '{}', 'utf8');
    const migrated = await findWorkspace(root);
    assert.equal(migrated.marker.schemaVersion, 1);
    assert.equal(JSON.parse(await readFile(path.join(root, 'resuflow.json'), 'utf8')).schemaVersion, 1);

    await writeFile(path.join(root, 'resuflow.json'), '{"schemaVersion":999}', 'utf8');
    await assert.rejects(() => findWorkspace(root), /supports up to 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy Resume Builder markers migrate to the ResuFlow marker', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resuflow-legacy-marker-'));
  try {
    await writeFile(path.join(root, 'resume-builder.json'), '{"schemaVersion":1}', 'utf8');

    const workspace = await findWorkspace(root);
    assert.equal(workspace.marker.schemaVersion, 1);
    assert.equal(await readFile(path.join(root, 'resume-builder.json'), 'utf8').catch(() => ''), '');
    assert.equal(JSON.parse(await readFile(path.join(root, 'resuflow.json'), 'utf8')).schemaVersion, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent profile writes leave a complete valid file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'resuflow-atomic-'));
  try {
    await initWorkspace(root);
    await Promise.all(Array.from({ length: 20 }, (_, index) => saveProfile(root, {
      name: `Writer ${index}`,
      body: `Body ${index}`,
    })));
    const contents = await readFile(path.join(root, 'profile.md'), 'utf8');
    assert.match(contents, /^---\nname: Writer \d+/);
    assert.match(contents, /Body \d+\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
