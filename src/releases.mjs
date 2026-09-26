import { readFileSync } from 'node:fs';

const REPOSITORY = 'exolithelabs/resuflow';
const RELEASES_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_URL_PREFIX = `https://github.com/${REPOSITORY}/releases/tag/`;
const CACHE_MS = 60 * 60 * 1000;
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let cachedRelease;

export const CURRENT_VERSION = packageJson.version;

export async function checkLatestRelease({
  fetchImpl = fetch,
  currentVersion = CURRENT_VERSION,
  useCache = true,
} = {}) {
  if (useCache && cachedRelease?.expiresAt > Date.now()) return cachedRelease.value;

  const response = await fetchImpl(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'resuflow',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    signal: AbortSignal.timeout(5000),
  });

  if (response.status === 404) {
    return cache({
      checked: true,
      available: false,
      currentVersion,
      latestVersion: null,
    }, useCache);
  }
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status}).`);

  const payload = await response.json();
  const latestVersion = normalizeVersion(payload.tag_name);
  const releaseUrl = validateReleaseUrl(payload.html_url);
  if (!latestVersion || !releaseUrl) throw new Error('GitHub returned an invalid release payload.');

  return cache({
    checked: true,
    available: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
    tagName: String(payload.tag_name),
    name: String(payload.name || payload.tag_name),
    publishedAt: typeof payload.published_at === 'string' ? payload.published_at : null,
    url: releaseUrl,
  }, useCache);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Cannot compare invalid versions: ${left}, ${right}`);

  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function normalizeVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  return `${parsed.numbers.join('.')}${parsed.prerelease.length ? `-${parsed.prerelease.join('.')}` : ''}`;
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function validateReleaseUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || !url.href.startsWith(RELEASE_URL_PREFIX)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function cache(value, enabled) {
  if (enabled) cachedRelease = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}
