if (new URLSearchParams(window.location.search).get('desktop') === '1') {
  document.documentElement.classList.add('desktop-app');
}

const app = document.querySelector('#app');
const saveStatus = document.querySelector('#save-status');
const releaseNotice = document.querySelector('#release-notice');
const releaseTitle = document.querySelector('#release-title');
const releaseDetail = document.querySelector('#release-detail');
const releaseLink = document.querySelector('#release-link');
const releaseDismiss = document.querySelector('#release-dismiss');

const createDialog = document.querySelector('#create-dialog');
const createForm = document.querySelector('#create-form');
const createTitle = document.querySelector('#create-title');
const createCancel = document.querySelector('#create-cancel');
const skillDialog = document.querySelector('#skill-dialog');
const skillForm = document.querySelector('#skill-form');
const skillName = document.querySelector('#skill-name');
const skillCancel = document.querySelector('#skill-cancel');

let saveTimer = 0;
let updateStatusTimer = 0;
let editorState = null;

window.addEventListener('hashchange', () => {
  closeSettingsMenu();
  render();
});

const settingsBtn = document.querySelector('#settings-btn');
const settingsDropdown = document.querySelector('#settings-dropdown');
const openBrowserBtn = document.querySelector('#open-browser');
const checkUpdatesBtn = document.querySelector('#check-updates');
settingsBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = settingsDropdown.hidden;
  settingsDropdown.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
});
settingsDropdown.addEventListener('click', () => closeSettingsMenu());
openBrowserBtn.addEventListener('click', async () => {
  await api('open-browser', {
    method: 'POST',
    body: JSON.stringify({ hash: location.hash }),
  });
});
checkUpdatesBtn.addEventListener('click', () => checkForLatestRelease({ manual: true }));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.settings-menu')) closeSettingsMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettingsMenu();
});

function closeSettingsMenu() {
  settingsDropdown.hidden = true;
  settingsBtn.setAttribute('aria-expanded', 'false');
}
createCancel.addEventListener('click', () => createDialog.close());
skillCancel.addEventListener('click', () => skillDialog.close());
skillForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = skillName.value.trim();
  if (!name) return;
  const skill = await api('skills', { method: 'POST', body: JSON.stringify({ name }) });
  skillDialog.close();
  skillForm.reset();
  location.hash = `#/skills/${skill.slug}`;
});
createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = createTitle.value.trim();
  if (!title) return;
  const resume = await api('resumes', { method: 'POST', body: JSON.stringify({ title }) });
  createDialog.close();
  createForm.reset();
  location.hash = `#/edit/${resume.slug}`;
});

await render();
checkForLatestRelease();

async function checkForLatestRelease({ manual = false } = {}) {
  try {
    const release = await api(`releases/latest${manual ? '?refresh=1' : ''}`);
    if (!release.available || !release.tagName || !release.url) {
      if (manual) showUpdateCheckStatus(`ResuFlow ${release.currentVersion} is up to date.`);
      return;
    }
    if (!manual && localStorage.getItem('resuflow-dismissed-release') === release.tagName) return;

    releaseTitle.textContent = `${release.name || release.tagName} is available.`;
    releaseDetail.textContent = `You are using ${release.currentVersion}. Review the release before updating.`;
    releaseLink.href = release.url;
    releaseNotice.hidden = false;

    releaseDismiss.onclick = () => {
      localStorage.setItem('resuflow-dismissed-release', release.tagName);
      releaseNotice.hidden = true;
    };
  } catch {
    // Release checks are optional and must never interrupt local work.
    if (manual) showUpdateCheckStatus('Could not check GitHub releases. Try again when online.');
  }
}

function showUpdateCheckStatus(message) {
  clearTimeout(updateStatusTimer);
  const previousMessage = saveStatus.textContent;
  const wasHidden = saveStatus.hidden;
  saveStatus.hidden = false;
  saveStatus.textContent = message;
  updateStatusTimer = setTimeout(() => {
    if (saveStatus.textContent !== message) return;
    saveStatus.textContent = previousMessage;
    saveStatus.hidden = wasHidden;
  }, 4000);
}

async function render() {
  const route = parseRoute();
  const backHome = document.querySelector('#back-home');
  if (backHome) backHome.hidden = route.name === 'dashboard';
  if (route.name === 'profile') {
    await renderProfileEditor();
    return;
  }
  if (route.name === 'skills') {
    await renderSkills();
    return;
  }
  if (route.name === 'skill') {
    await renderSkillEditor(route.slug);
    return;
  }
  if (route.name === 'memory') {
    await renderMemory();
    return;
  }
  if (route.name === 'docs') {
    await renderDocs();
    return;
  }
  if (route.name === 'vault') {
    await renderVault();
    return;
  }
  if (route.name === 'edit' || route.name === 'preview') {
    await renderEditor(route.slug, route.name);
    return;
  }
  await renderDashboard();
}

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash === '/profile' || hash === '/profile/edit' || hash === '/profile/preview') {
    return { name: 'profile' };
  }
  if (hash === '/skills') return { name: 'skills' };
  if (hash === '/memory') return { name: 'memory' };
  if (hash === '/vault') return { name: 'vault' };
  if (hash === '/docs' || hash.startsWith('/docs/') || hash === '/settings' || hash === '/mcp') {
    return { name: 'docs' };
  }
  const skill = hash.match(/^\/skills\/([^/]+)\/?$/);
  if (skill) return { name: 'skill', slug: decodeURIComponent(skill[1]) };
  const edit = hash.match(/^\/(edit|preview)\/([^/]+)\/?$/);
  if (edit) return { name: edit[1], slug: decodeURIComponent(edit[2]) };
  return { name: 'dashboard' };
}

async function renderDashboard() {
  editorState = null;
  saveStatus.hidden = true;
  const { resumes } = await api('resumes');

  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">Local workspace</p>
        <h1>Your resumes</h1>
        <p class="lede">Everything is Markdown. Use Edit to write, Preview to see the page.</p>
      </div>
      <div class="actions">
        <button class="primary" id="new-resume">New resume</button>
      </div>
    </section>

    <section class="toolbar">
      <span class="muted">${resumes.length} ${resumes.length === 1 ? 'resume' : 'resumes'}</span>
      <label class="search">
        <span class="sr-only">Search</span>
        <input id="resume-search" type="search" placeholder="Search role or title…" />
      </label>
    </section>
    <section id="resume-grid" class="resume-list-wrap"></section>
  `;

  const grid = app.querySelector('#resume-grid');
  const search = app.querySelector('#resume-search');
  const draw = (items) => {
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><h2>No resumes yet</h2><p>Create a resume, then write it in Markdown. Preview renders the designed page.</p></div>`;
      return;
    }
    grid.innerHTML = `<ul class="resume-list">${items.map(listItemHtml).join('')}</ul>`;
  };
  draw(resumes);
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    draw(resumes.filter((resume) => [resume.title, resume.summary, ...(resume.tags || [])].join(' ').toLowerCase().includes(query)));
  });

  app.querySelector('#new-resume').addEventListener('click', () => {
    createTitle.value = '';
    createDialog.showModal();
    createTitle.focus();
  });

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const slug = button.dataset.slug;
    if (button.dataset.action === 'delete') {
      if (!confirm(`Delete ${slug}? This cannot be undone.`)) return;
      await api('resume', withSlug(slug, { method: 'DELETE' }));
      await renderDashboard();
    }
    if (button.dataset.action === 'pdf') {
      button.disabled = true;
      try {
        await api('resume/pdf', withSlug(slug, { method: 'POST' }));
        window.location = `/api/resumes/${encodeURIComponent(slug)}/pdf`;
      } finally {
        button.disabled = false;
      }
    }
  });

}

function listItemHtml(resume) {
  return `
    <li class="resume-row">
      <a class="resume-title" href="#/edit/${encodeURIComponent(resume.slug)}">${escapeHtml(resume.title)}</a>
      <span class="badge">${escapeHtml(resume.status || 'draft')}</span>
      <span class="muted">${resume.updated ? escapeHtml(resume.updated) : ''}</span>
      <div class="row-actions">
        <a class="secondary" href="#/edit/${encodeURIComponent(resume.slug)}">Edit</a>
        <a class="secondary" href="#/preview/${encodeURIComponent(resume.slug)}">Preview</a>
        <button class="secondary" data-action="pdf" data-slug="${escapeHtml(resume.slug)}">PDF</button>
        <button class="danger" data-action="delete" data-slug="${escapeHtml(resume.slug)}">Delete</button>
      </div>
    </li>
  `;
}

async function renderSkills() {
  editorState = null;
  saveStatus.hidden = true;
  const { skills } = await api('skills');
  app.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">Agent</p>
        <h1>Skills</h1>
        <p class="lede">Built-in skills ship with the app. Custom skills live in this workspace. Agents load them through the MCP server.</p>
      </div>
      <button class="primary" id="new-skill">New skill</button>
    </section>
    <ul class="resume-list">
      ${skills.map((skill) => `
        <li class="resume-row">
          <a class="resume-title" href="#/skills/${encodeURIComponent(skill.slug)}">${escapeHtml(skill.name)}</a>
          <span class="badge">${escapeHtml(skill.source)}${skill.enabled === false ? ' · off' : ''}</span>
          <span class="muted">${escapeHtml(skill.description || '')}</span>
          <div class="row-actions">
            <button class="secondary" data-action="toggle-skill" data-slug="${escapeHtml(skill.slug)}" data-enabled="${skill.enabled !== false}">${skill.enabled === false ? 'Enable' : 'Disable'}</button>
            <a class="secondary" href="#/skills/${encodeURIComponent(skill.slug)}">Open</a>
            ${skill.source === 'user' ? `<button class="danger" data-action="delete-skill" data-slug="${escapeHtml(skill.slug)}">Delete</button>` : ''}
          </div>
        </li>
      `).join('')}
    </ul>
  `;
  app.querySelector('#new-skill').addEventListener('click', () => {
    skillName.value = '';
    skillDialog.showModal();
    skillName.focus();
  });
  app.querySelector('.resume-list').addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-action=toggle-skill]');
    if (toggle) {
      const enabled = toggle.dataset.enabled !== 'true';
      await api('skill/enabled', withSlug(toggle.dataset.slug, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }));
      await renderSkills();
      return;
    }
    const remove = event.target.closest('[data-action=delete-skill]');
    if (!remove) return;
    if (!confirm(`Delete skill ${remove.dataset.slug}?`)) return;
    await api('skill', withSlug(remove.dataset.slug, { method: 'DELETE' }));
    await renderSkills();
  });
}

async function renderSkillEditor(slug) {
  const skill = await api('skill', withSlug(slug));
  editorState = { kind: 'skill', slug, markdown: skill.markdown, source: skill.source };
  saveStatus.hidden = skill.source === 'builtin';
  app.innerHTML = `
    <section class="doc">
      <div class="doc-toolbar">
        <a class="ghost" href="#/skills">← Skills</a>
        <span class="badge">${escapeHtml(skill.source)}${skill.enabled === false ? ' · off' : ''}</span>
        <button class="secondary" id="toggle-skill">${skill.enabled === false ? 'Enable' : 'Disable'}</button>
      </div>
      <textarea class="md-editor" id="markdown" ${skill.source === 'builtin' ? 'readonly' : ''} spellcheck="true">${escapeHtml(skill.markdown)}</textarea>
    </section>
  `;
  const editor = app.querySelector('#markdown');
  if (skill.source !== 'builtin') {
    editor.addEventListener('input', () => {
      editorState.markdown = editor.value;
      queueSave(async () => {
        await api('skill', withSlug(slug, { method: 'PUT', body: JSON.stringify({ markdown: editorState.markdown }) }));
        saveStatus.textContent = 'Saved';
      });
    });
  }
  editor.focus();
  app.querySelector('#toggle-skill').addEventListener('click', async () => {
    await api('skill/enabled', withSlug(slug, {
      method: 'PUT',
      body: JSON.stringify({ enabled: skill.enabled === false }),
    }));
    await renderSkillEditor(slug);
  });
}

async function renderMemory() {
  const memory = await api('memory');
  editorState = { kind: 'memory', markdown: memory.markdown };
  saveStatus.hidden = false;
  app.innerHTML = `
    <section class="doc">
      <textarea class="md-editor" id="markdown" spellcheck="true" aria-label="Memory Markdown">${escapeHtml(memory.markdown)}</textarea>
    </section>
  `;
  const editor = app.querySelector('#markdown');
  editor.addEventListener('input', () => {
    editorState.markdown = editor.value;
    queueSave(async () => {
      await api('memory', { method: 'PUT', body: JSON.stringify({ markdown: editorState.markdown }) });
      saveStatus.textContent = 'Saved';
    });
  });
  editor.focus();
}

async function renderVault() {
  editorState = null;
  saveStatus.hidden = true;
  const workspace = await api('workspace');
  const recent = (workspace.recentVaults || []).filter((item) => item && item !== workspace.root);
  app.innerHTML = `
    <section class="doc">
      <form id="vault-form" class="empty-state">
        <h2>Vault</h2>
        <p class="muted">Your resumes live in a vault folder, not in the app install. The default vault is used when you run <code>resuflow</code> without <code>--dir</code>.</p>
        <p><strong>Current:</strong> <code>${escapeHtml(workspace.root)}</code></p>
        <p><strong>Default:</strong> <code>${escapeHtml(workspace.defaultVault || workspace.root)}</code></p>
        <label class="field"><span>Vault path</span><input name="root" value="${escapeHtml(workspace.root)}" required /></label>
        <div class="actions">
          <button class="primary" type="submit" data-mode="switch">Switch vault</button>
          <button class="secondary" type="submit" data-mode="init">Create vault here</button>
        </div>
        ${recent.length ? `<h3>Recent</h3><ul class="resume-list">${recent.map((item) => `
          <li class="resume-row">
            <span class="resume-title">${escapeHtml(item)}</span>
            <div class="row-actions">
              <button type="button" class="secondary" data-recent="${escapeHtml(item)}">Use</button>
            </div>
          </li>
        `).join('')}</ul>` : ''}
      </form>
    </section>
  `;
  const form = app.querySelector('#vault-form');
  const input = form.querySelector('input[name=root]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = event.submitter?.dataset.mode || 'switch';
    try {
      await api('workspace', {
        method: 'PUT',
        body: JSON.stringify({
          root: input.value.trim(),
          init: mode === 'init',
          setDefault: true,
        }),
      });
      location.hash = '#/';
      await render();
    } catch (error) {
      saveStatus.hidden = false;
      saveStatus.textContent = error.message;
    }
  });
  form.querySelectorAll('[data-recent]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.recent;
      form.requestSubmit(form.querySelector('[data-mode=switch]'));
    });
  });
}

async function renderDocs() {
  editorState = null;
  saveStatus.hidden = true;
  const info = await api('mcp');
  const snippet = JSON.stringify(info.generic, null, 2);
  app.innerHTML = `
    <article class="docs-page">
      <header class="docs-hero">
        <p class="eyebrow">Guide</p>
        <h1>Read docs</h1>
        <p class="lede">How this local resume app works: data, Markdown, skills, memory, and connecting your own agents over MCP.</p>
      </header>
      <nav class="docs-toc">
        <a href="#/docs/overview">Overview</a>
        <a href="#/docs/install">Install and run</a>
        <a href="#/docs/workspace">Workspace</a>
        <a href="#/docs/resumes">Resumes</a>
        <a href="#/docs/profile">Profile</a>
        <a href="#/docs/skills">Skills</a>
        <a href="#/docs/memory">Memory</a>
        <a href="#/docs/mcp">MCP</a>
      </nav>

      <section class="docs-section" id="docs-overview">
        <h2>Overview</h2>
        <p>ResuFlow is a local app. It does not run an LLM. You write Markdown in the UI, or you point Grok, Cursor, Codex, Gemini, or another agent at this process over MCP.</p>
        <p>The product (this install) is separate from your data. Resumes live in a workspace folder under Documents; first launch creates a default vault automatically.</p>
      </section>

      <section class="docs-section" id="docs-install">
        <h2>Install and run</h2>
        <p>Windows users can download the installer from the product website; Node.js and npm are bundled. On Arch Linux, install the pacman package from the latest GitHub release.</p>
        <pre>Windows: download and run the .exe installer
Linux (Arch): sudo pacman -U resuflow-linux-x86_64.pkg.tar.zst</pre>
        <ul>
          <li><code>resuflow</code> opens the desktop window by default.</li>
          <li><code>resuflow --browser</code> opens the same UI in a web browser.</li>
          <li><code>resuflow serve</code> starts the server only.</li>
          <li>On Windows, download updates from the product website. On Arch Linux, install the newer package with <code>sudo pacman -U</code>.</li>
          <li>Removing the app does not remove your workspace.</li>
        </ul>
        <p>The UI is at <code>http://127.0.0.1:4173/</code> while the app is running.</p>
      </section>

      <section class="docs-section" id="docs-workspace">
        <h2>Workspace</h2>
        <p>Open <strong>Vault</strong> from the settings gear to see the path or change the default vault. Typical layout:</p>
        <pre>profile.md
memory.md
skills/disabled.json
skills/&lt;slug&gt;/SKILL.md
resumes/&lt;slug&gt;/resume.md
resumes/&lt;slug&gt;/dist/resume.pdf</pre>
        <p>Do not put personal resume data in the app install. Git in the vault is optional and not created automatically.</p>
      </section>

      <section class="docs-section" id="docs-resumes">
        <h2>Resumes</h2>
        <p>The home page is a list. Create a resume, then use <strong>Edit</strong> and <strong>Preview</strong>.</p>
        <ul>
          <li>Edit is the Markdown file, including YAML frontmatter (<code>title</code>, <code>status</code>, <code>tags</code>).</li>
          <li>Preview renders the designed page.</li>
          <li>PDF prints that preview to A4.</li>
          <li>Changes autosave.</li>
        </ul>
        <p>The header <strong>← All resumes</strong> link appears on resume, profile, skills, memory, and docs pages — not on the home list.</p>
      </section>

      <section class="docs-section" id="docs-profile">
        <h2>Profile</h2>
        <p>Shared identity is <code>profile.md</code>. Open it from the settings gear. It is edit-only Markdown (name, email, and links in the frontmatter). Preview uses this header on every resume.</p>
      </section>

      <section class="docs-section" id="docs-skills">
        <h2>Skills</h2>
        <p>Skills are Markdown instructions agents can follow. Built-in skills ship with the app (research, impact writer, ATS optimizer, critic). You can create your own; those files live in the workspace.</p>
        <ul>
          <li>Enable or disable any skill. Disabled skills stay in the list but are hidden from MCP <code>list_skills</code>.</li>
          <li>Built-in skills cannot be edited or deleted. Duplicate the idea as a custom skill if you need to change the text.</li>
        </ul>
      </section>

      <section class="docs-section" id="docs-memory">
        <h2>Memory</h2>
        <p><code>memory.md</code> is durable notes for agents: facts, target roles, tone. Edit it from the settings gear. Agents can read and append through MCP (<code>get_memory</code>, <code>write_memory</code>, <code>append_memory</code>).</p>
      </section>

      <section class="docs-section" id="docs-mcp">
        <h2>MCP</h2>
        <p>While the app is running it hosts an MCP server in this process. Point your agent at:</p>
        <p><code>${escapeHtml(info.url)}</code></p>
        <p>Example config:</p>
        <pre>${escapeHtml(snippet)}</pre>
        <p>This configuration contains a private per-process bearer token. Do not publish or commit it; copy a fresh configuration after restarting ResuFlow.</p>
        <p>Tools include list/get/write for resumes, profile, skills, and memory, plus create resume, enable-aware skill listing, and PDF-related files on disk after you export.</p>
      </section>
    </article>
  `;
  const hash = location.hash.replace(/^#/, '');
  const key = hash === '/mcp' ? 'mcp' : hash.replace(/^\/docs\/?/, '');
  const target = document.getElementById(key ? `docs-${key}` : 'docs-overview');
  if (target && key) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderProfileEditor() {
  if (!editorState || editorState.kind !== 'profile') {
    const profile = await api('profile');
    editorState = { kind: 'profile', markdown: profile.markdown };
  }
  saveStatus.hidden = false;

  app.innerHTML = `
    <section class="doc">
      <textarea class="md-editor" id="markdown" spellcheck="true" aria-label="Profile Markdown">${escapeHtml(editorState.markdown)}</textarea>
    </section>
  `;

  const editor = app.querySelector('#markdown');
  if (editor) {
    editor.addEventListener('input', () => {
      editorState.markdown = editor.value;
      queueSave(saveProfileEditor);
    });
    editor.focus();
  }
}

async function saveProfileEditor() {
  if (!editorState || editorState.kind !== 'profile') return;
  saveStatus.textContent = 'Saving…';
  const saved = await api('profile', {
    method: 'PUT',
    body: JSON.stringify({ markdown: editorState.markdown }),
  });
  editorState.markdown = saved.markdown;
  saveStatus.textContent = 'Saved';
}

async function renderEditor(slug, mode) {
  if (editorState?.kind === 'resume' && editorState.resume.slug === slug) {
    if (mode === 'preview') await saveEditor();
  } else {
    const resume = await api('resume', withSlug(slug));
    editorState = { kind: 'resume', resume };
  }
  paintEditor(mode);
}

function paintEditor(mode) {
  if (!editorState) return;
  const { resume } = editorState;
  const slug = resume.slug;
  saveStatus.hidden = false;

  app.innerHTML = `
    <section class="doc">
      <div class="doc-toolbar">
        <div class="mode-switch" role="tablist">
          <a class="mode${mode === 'edit' ? ' active' : ''}" href="#/edit/${encodeURIComponent(slug)}">Edit</a>
          <a class="mode${mode === 'preview' ? ' active' : ''}" href="#/preview/${encodeURIComponent(slug)}">Preview</a>
        </div>
        <button type="button" class="secondary" id="export-pdf">Download PDF</button>
      </div>
      ${mode === 'edit' ? `
        <textarea class="md-editor" id="markdown" spellcheck="true" aria-label="Resume Markdown">${escapeHtml(resume.markdown)}</textarea>
      ` : `
        <iframe class="preview-frame" id="preview" title="Resume preview" sandbox="allow-popups allow-popups-to-escape-sandbox" src="/preview/${encodeURIComponent(slug)}?t=${Date.now()}"></iframe>
      `}
    </section>
  `;

  const editor = app.querySelector('#markdown');
  if (editor) {
    editor.addEventListener('input', () => {
      editorState.resume.markdown = editor.value;
      queueSave(saveEditor);
    });
    editor.focus();
  }

  app.querySelector('#export-pdf').addEventListener('click', async () => {
    await saveEditor();
    await api('resume/pdf', withSlug(slug, { method: 'POST' }));
    window.location = `/api/resumes/${encodeURIComponent(slug)}/pdf`;
  });
}

async function saveEditor() {
  if (!editorState) return;
  saveStatus.textContent = 'Saving…';
  const saved = await api('resume', withSlug(editorState.resume.slug, {
    method: 'PUT',
    body: JSON.stringify({ markdown: editorState.resume.markdown }),
  }));
  editorState.resume = saved;
  saveStatus.textContent = 'Saved';
}

function queueSave(fn) {
  saveStatus.hidden = false;
  saveStatus.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fn().catch((error) => {
    saveStatus.textContent = error.message;
  }), 400);
}

async function api(endpoint, options = {}) {
  const response = await fetch(`/api/${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-ResuFlow-Request': '1',
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function withSlug(slug, options = {}) {
  return {
    ...options,
    headers: {
      'X-ResuFlow-Slug': String(slug),
      ...(options.headers || {}),
    },
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
