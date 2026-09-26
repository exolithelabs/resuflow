import { access, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  excerpt,
  jsonResumeToMarkdown,
  parseFrontmatter,
  serializeProfileMarkdown,
  serializeResumeMarkdown,
  starterMarkdown,
  starterProfileMarkdown,
} from './markdown.mjs';
import { atomicWriteFile } from './atomic-write.mjs';

export const SCHEMA_VERSION = 1;
export const WORKSPACE_FILE = 'resuflow.json';
export const LEGACY_WORKSPACE_FILE = 'resume-builder.json';
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
  }
}

export function emptyProfile() {
  return {
    name: '',
    headline: '',
    email: '',
    phone: '',
    location: '',
    website: '',
    linkedin: '',
    github: '',
    links: [],
  };
}

export function emptyResume(slug, title = '') {
  const markdown = starterMarkdown(title || slug);
  return markdownToResume(markdown, slug);
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function monthStamp(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function assertSlug(slug, kind = 'resume') {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new WorkspaceError(`Invalid ${kind} slug: ${slug || '(empty)'}`);
  }
}

export async function findWorkspace(startDir) {
  const dir = path.resolve(startDir || process.cwd());
  const marker = await resolveWorkspaceMarker(dir);
  let markerText;
  try {
    markerText = await readFile(marker, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new WorkspaceError(
      `No resume workspace found in ${dir}. Run \`resuflow init\` first.`,
      400,
    );
  }
  let markerPayload;
  try {
    markerPayload = JSON.parse(markerText);
  } catch {
    throw new WorkspaceError(`Invalid ${WORKSPACE_FILE}: expected valid JSON.`);
  }
  markerPayload = await migrateWorkspaceMarker(marker, markerPayload);
  return { root: dir, marker: markerPayload };
}

/**
 * Resolve the workspace marker, migrating a legacy Resume Builder marker in place so
 * existing vaults keep working without a re-init step. Falls back to reading the legacy
 * file when it cannot be renamed, for example on a read-only volume.
 */
async function resolveWorkspaceMarker(dir) {
  const marker = path.join(dir, WORKSPACE_FILE);
  if (await exists(marker)) return marker;

  const legacyMarker = path.join(dir, LEGACY_WORKSPACE_FILE);
  if (!(await exists(legacyMarker))) return marker;

  try {
    await rename(legacyMarker, marker);
    return marker;
  } catch {
    return legacyMarker;
  }
}

export async function initWorkspace(targetDir) {
  const root = path.resolve(targetDir || process.cwd());
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, 'resumes'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'skills'), { recursive: true });

  const markerPath = await resolveWorkspaceMarker(root);
  const profilePath = path.join(root, 'profile.md');
  const readmePath = path.join(root, 'README.md');
  const gitignorePath = path.join(root, '.gitignore');

  const alreadyWorkspace = await exists(markerPath);
  if (!alreadyWorkspace) {
    await writeJson(markerPath, {
      schemaVersion: SCHEMA_VERSION,
      created: new Date().toISOString(),
    });
  }

  if (!(await exists(profilePath)) && !(await exists(path.join(root, 'profile.json')))) {
    await atomicWriteFile(profilePath, starterProfileMarkdown(), 'utf8');
  }

  if (!(await exists(readmePath))) {
    await atomicWriteFile(readmePath, dataRepoReadme(), 'utf8');
  }

  if (!(await exists(gitignorePath))) {
    await atomicWriteFile(gitignorePath, '*.log\n.DS_Store\nThumbs.db\nsettings.json\n', 'utf8');
  }

  return findWorkspace(root);
}

export async function loadProfile(root) {
  const mdFile = path.join(root, 'profile.md');
  const jsonFile = path.join(root, 'profile.json');

  if (await exists(mdFile)) {
    return markdownToProfile(await readFile(mdFile, 'utf8'));
  }

  if (await exists(jsonFile)) {
    const profile = markdownToProfile(serializeProfileMarkdown(normalizeProfile(JSON.parse(await readFile(jsonFile, 'utf8')))));
    await atomicWriteFile(mdFile, profile.markdown, 'utf8');
    return profile;
  }

  const profile = markdownToProfile(starterProfileMarkdown());
  await atomicWriteFile(mdFile, profile.markdown, 'utf8');
  return profile;
}

export async function saveProfile(root, input) {
  const markdown = typeof input?.markdown === 'string'
    ? input.markdown
    : serializeProfileMarkdown({ ...emptyProfile(), ...input });
  const next = markdownToProfile(markdown);
  await atomicWriteFile(path.join(root, 'profile.md'), next.markdown, 'utf8');
  return next;
}

export async function listResumes(root) {
  const resumesDir = path.join(root, 'resumes');
  await mkdir(resumesDir, { recursive: true });
  const entries = await readdir(resumesDir, { withFileTypes: true });
  const resumes = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const resume = await loadResume(root, entry.name);
      resumes.push(summarizeResume(resume));
    } catch {
      // skip malformed folders
    }
  }

  resumes.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.title.localeCompare(b.title));
  return resumes;
}

export async function loadResume(root, slug) {
  assertSlug(slug);
  const mdFile = resumeMarkdownFile(root, slug);
  const jsonFile = resumeJsonFile(root, slug);

  if (await exists(mdFile)) {
    const markdown = await readFile(mdFile, 'utf8');
    return markdownToResume(markdown, slug);
  }

  if (await exists(jsonFile)) {
    const payload = JSON.parse(await readFile(jsonFile, 'utf8'));
    const markdown = jsonResumeToMarkdown({ ...payload, slug });
    await atomicWriteFile(mdFile, markdown, 'utf8');
    return markdownToResume(markdown, slug);
  }

  throw new WorkspaceError(`Resume not found: ${slug}`, 404);
}

export async function createResume(root, input) {
  const title = String(input?.title || '').trim();
  if (!title) throw new WorkspaceError('A resume title is required.');
  const slug = slugify(input.slug || title);
  assertSlug(slug);

  const file = resumeMarkdownFile(root, slug);
  if (await exists(file) || (await exists(resumeJsonFile(root, slug)))) {
    throw new WorkspaceError(`A resume with slug "${slug}" already exists.`, 409);
  }

  const resume = emptyResume(slug, title);
  resume.updated = monthStamp();
  resume.markdown = serializeResumeMarkdown(resume);
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, resume.markdown, 'utf8');
  return resume;
}

export async function saveResume(root, slug, input) {
  assertSlug(slug);
  await loadResume(root, slug);
  const markdown = typeof input?.markdown === 'string'
    ? input.markdown
    : serializeResumeMarkdown({
      title: input.title,
      status: input.status,
      tags: input.tags,
      updated: monthStamp(),
      body: input.body,
    });
  const next = markdownToResume(markdown, slug);
  next.updated = monthStamp();
  next.markdown = serializeResumeMarkdown(next);
  await atomicWriteFile(resumeMarkdownFile(root, slug), next.markdown, 'utf8');
  return next;
}

export async function deleteResume(root, slug) {
  assertSlug(slug);
  const dir = path.join(root, 'resumes', slug);
  if (!(await exists(dir))) {
    throw new WorkspaceError(`Resume not found: ${slug}`, 404);
  }
  await rm(dir, { recursive: true, force: true });
  const centralPdf = path.join(root, 'dist', `${slug}.pdf`);
  if (await exists(centralPdf)) {
    await rm(centralPdf, { force: true });
  }
}

function resumeMarkdownFile(root, slug) {
  return path.join(root, 'resumes', slug, 'resume.md');
}

function resumeJsonFile(root, slug) {
  return path.join(root, 'resumes', slug, 'resume.json');
}

function markdownToProfile(markdown) {
  const { meta, body } = parseFrontmatter(markdown);
  const profile = normalizeProfile({
    name: meta.name,
    headline: meta.headline,
    email: meta.email,
    phone: meta.phone,
    location: meta.location,
    website: meta.website,
    linkedin: meta.linkedin,
    github: meta.github,
  });
  profile.body = body;
  profile.markdown = serializeProfileMarkdown(profile);
  return profile;
}

function markdownToResume(markdown, slug) {
  const { meta, body } = parseFrontmatter(markdown);
  const tags = String(meta.tags || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const status = ['draft', 'active', 'archived'].includes(meta.status) ? meta.status : 'draft';
  return {
    slug,
    title: String(meta.title || slug),
    status,
    tags,
    updated: String(meta.updated || monthStamp()),
    body,
    markdown: serializeResumeMarkdown({
      title: meta.title || slug,
      status,
      tags,
      updated: meta.updated || monthStamp(),
      body,
    }),
    summary: excerpt(body),
    template: 'classic',
  };
}

function summarizeResume(resume) {
  return {
    slug: resume.slug,
    title: resume.title,
    status: resume.status,
    updated: resume.updated,
    summary: resume.summary,
    tags: resume.tags,
    template: resume.template,
  };
}

function normalizeProfile(input = {}) {
  const profile = emptyProfile();
  profile.name = String(input.name || '');
  profile.headline = String(input.headline || '');
  profile.email = String(input.email || '');
  profile.phone = String(input.phone || '');
  profile.location = String(input.location || '');
  profile.website = String(input.website || '');
  profile.linkedin = String(input.linkedin || '');
  profile.github = String(input.github || '');
  profile.links = Array.isArray(input.links)
    ? input.links
        .map((link) => ({
          label: String(link?.label || '').trim(),
          url: String(link?.url || '').trim(),
        }))
        .filter((link) => link.label || link.url)
    : [];
  return profile;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function migrateWorkspaceMarker(markerPath, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WorkspaceError(`Invalid ${WORKSPACE_FILE}: expected a JSON object.`);
  }
  const version = payload.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0) {
    throw new WorkspaceError(`Invalid ${WORKSPACE_FILE}: schemaVersion must be a non-negative integer.`);
  }
  if (version > SCHEMA_VERSION) {
    throw new WorkspaceError(
      `This workspace uses schema version ${version}, but this app supports up to ${SCHEMA_VERSION}. Update ResuFlow first.`,
      409,
    );
  }
  if (version === SCHEMA_VERSION) return payload;

  const migrated = {
    ...payload,
    schemaVersion: SCHEMA_VERSION,
    migrated: new Date().toISOString(),
  };
  await writeJson(markerPath, migrated);
  return migrated;
}

function dataRepoReadme() {
  return `# Resume workspace

This folder is **your resume data**, not the ResuFlow app.

- \`profile.md\` — shared name, contact details, and links
- \`memory.md\` — durable notes for the resume agent
- \`skills/<slug>/SKILL.md\` — custom agent skills
- \`resumes/<slug>/resume.md\` — each role-specific resume (Markdown)
- MCP server (while the app is running): \`http://127.0.0.1:4173/mcp\` with the per-process bearer token shown in the app
- Generated PDFs land in \`resumes/<slug>/dist/resume.pdf\` and \`dist/<slug>.pdf\`

Edit everything in the local web UI:

\`\`\`bash
resuflow
\`\`\`

This folder is your data, not the app. Git is optional; the app does not initialize a repository.
`;
}
