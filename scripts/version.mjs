import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  package: path.join(repoRoot, 'package.json'),
  packageLock: path.join(repoRoot, 'package-lock.json'),
  tauri: path.join(repoRoot, 'src-tauri', 'tauri.conf.json'),
  cargo: path.join(repoRoot, 'src-tauri', 'Cargo.toml'),
  cargoLock: path.join(repoRoot, 'src-tauri', 'Cargo.lock'),
  pkgbuild: path.join(repoRoot, 'distro', 'arch', 'PKGBUILD'),
  srcinfo: path.join(repoRoot, 'distro', 'arch', '.SRCINFO'),
  metainfo: path.join(repoRoot, 'distro', 'linux', 'io.github.exolithelabs.ResuFlow.metainfo.xml'),
};
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function cargoPackageVersion(contents) {
  return contents.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
}

function cargoLockPackageVersion(contents) {
  return contents.match(/\[\[package\]\]\r?\nname = "resuflow"\r?\nversion = "([^"]+)"/)?.[1];
}

function pkgbuildVersion(contents) {
  return contents.match(/^pkgver=([^\s]+)/m)?.[1];
}

function srcinfoVersion(contents) {
  const normalized = String(contents || '').split('\r\n').join('\n');
  return normalized.match(/pkgver = ([^\s]+)/)?.[1];
}

function metainfoReleaseVersion(contents) {
  const normalized = String(contents || '').split('\r\n').join('\n');
  return normalized.match(/<release\s+version="([^"]+)"/)?.[1];
}

async function readVersions() {
  const [packageText, lockText, tauriText, cargoText, cargoLockText, pkgbuildText, srcinfoText, metainfoText] = await Promise.all(
    [files.package, files.packageLock, files.tauri, files.cargo, files.cargoLock, files.pkgbuild, files.srcinfo, files.metainfo].map((file) => readFile(file, 'utf8')),
  );
  const packageJson = JSON.parse(packageText);
  const packageLock = JSON.parse(lockText);
  const tauri = JSON.parse(tauriText);
  return {
    versions: {
      'package.json': packageJson.version,
      'package-lock.json': packageLock.version,
      'package-lock.json (root package)': packageLock.packages?.['']?.version,
      'src-tauri/tauri.conf.json': tauri.version,
      'src-tauri/Cargo.toml': cargoPackageVersion(cargoText),
      'src-tauri/Cargo.lock': cargoLockPackageVersion(cargoLockText),
      'distro/arch/PKGBUILD': pkgbuildVersion(pkgbuildText),
      'distro/arch/.SRCINFO': srcinfoVersion(srcinfoText),
      'distro/linux/io.github.exolithelabs.ResuFlow.metainfo.xml': metainfoReleaseVersion(metainfoText),
    },
    source: { packageJson, packageLock, tauri, cargoText, cargoLockText },
  };
}

function assertInSync(versions, expectedTag) {
  const expected = Object.values(versions)[0];
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (!expected || mismatches.length > 0) {
    throw new Error(`Version mismatch:\n${Object.entries(versions).map(([file, version]) => `  ${file}: ${version ?? 'missing'}`).join('\n')}`);
  }
  if (expectedTag && expectedTag !== `v${expected}`) {
    throw new Error(`Release tag ${expectedTag} does not match version v${expected}.`);
  }
  console.log(`All package versions are ${expected}${expectedTag ? ` and match ${expectedTag}` : ''}.`);
}

const [command, value] = process.argv.slice(2);
const current = await readVersions();

if (!command || command === '--check') {
  assertInSync(current.versions, value);
  process.exit(0);
}

if (command !== '--set' || !semverPattern.test(value || '')) {
  throw new Error('Usage: npm run version:set -- <semver>\n       npm run version:check -- [v<semver>]');
}

const { packageJson, packageLock, tauri, cargoText, cargoLockText } = current.source;
packageJson.version = value;
packageLock.version = value;
packageLock.packages[''].version = value;
tauri.version = value;

const nextCargo = cargoText.replace(
  /(^\[package\]\s*$[\s\S]*?^version\s*=\s*")[^"]+(".*$)/m,
  (_match, prefix, suffix) => `${prefix}${value}${suffix}`,
);
const nextCargoLock = cargoLockText.replace(
  /(\[\[package\]\]\r?\nname = "resuflow"\r?\nversion = ")[^"]+("\r?$)/m,
  (_match, prefix, suffix) => `${prefix}${value}${suffix}`,
);

const nextRelease = `v${value}`;
const readText = (file) => readFile(file, 'utf8');
const syncFile = (file, from, to) => readText(file).then((text) => {
  const next = text.split(from).join(to);
  // Allow resuming after a prior run updated this file but failed later.
  if (next === text && !text.includes(to)) {
    throw new Error(`${file} is missing the expected ${from} release reference.`);
  }
  if (next === text) return undefined;
  return writeFile(file, next, 'utf8');
});
const distroVersion = current.versions['distro/arch/PKGBUILD'];
await syncFile(files.pkgbuild, `pkgver=${distroVersion}`, `pkgver=${value}`);
await syncFile(files.srcinfo, `pkgver = ${distroVersion}`, `pkgver = ${value}`);
// The PKGBUILD source URLs are parameterized as v${pkgver} and follow pkgver automatically.
// .SRCINFO carries fully expanded URLs, so the full filename moves here.
const syncSrcinfoSourceFromAnyVersion = (suffix) => readText(files.srcinfo).then((text) => {
  // .SRCINFO keeps a filename and fully expanded URL on each source line.
  // Rewrite that line as a pair so interrupted earlier runs remain recoverable.
  const lines = text.split(/\r?\n/);
  // Match the base archive explicitly, or match each dependency-cache suffix.
  const sourceIndex = lines.findIndex((line) => {
    const entry = line.trimStart().replace(/^source = /, '');
    return suffix
      ? entry.startsWith('resuflow-') && entry.includes(`${suffix}.tar.gz::`)
      : /^resuflow-\d+\.\d+\.\d+\.tar\.gz::/.test(entry);
  });
  if (sourceIndex < 0) throw new Error(`${files.srcinfo} is missing the ${suffix || 'base source'} entry.`);
  const filename = `resuflow-${value}${suffix}.tar.gz`;
  lines[sourceIndex] = `\tsource = ${filename}::https://github.com/exolithelabs/resuflow/releases/download/${nextRelease}/${filename}`;
  return writeFile(files.srcinfo, lines.join(text.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
});
await syncSrcinfoSourceFromAnyVersion('');
await syncSrcinfoSourceFromAnyVersion('-npm-cache');
await syncSrcinfoSourceFromAnyVersion('-cargo-cache');

// The published AppStream metadata carries the newest release first.
const metainfoText = await readText(files.metainfo);
if (!metainfoText.includes('<releases>')) throw new Error('The AppStream metainfo file is missing a <releases> element.');
const metainfoNewline = metainfoText.includes('\r\n') ? '\r\n' : '\n';
const releaseEntry = `    <release version="${value}" date="${new Date().toISOString().slice(0, 10)}"/>`;
const releasePattern = /(<releases>\r?\n)([\s\S]*?)(?=\s*<\/releases>)/;
if (!releasePattern.test(metainfoText)) throw new Error('The AppStream metainfo file is missing its releases list.');
const nextMetainfo = metainfoText.replace(releasePattern, (_match, prefix, entries) => {
  const releaseLines = entries
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('<release '))
    .filter((line) => !line.includes(`<release version="${value}"`));
  return `${prefix}${releaseEntry}${releaseLines.length ? `${metainfoNewline}    ${releaseLines.join(`${metainfoNewline}    `)}` : ''}${metainfoNewline}`;
});

await Promise.all([
  writeFile(files.package, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8'),
  writeFile(files.packageLock, `${JSON.stringify(packageLock, null, 2)}\n`, 'utf8'),
  writeFile(files.tauri, `${JSON.stringify(tauri, null, 2)}\n`, 'utf8'),
  writeFile(files.cargo, nextCargo, 'utf8'),
  writeFile(files.cargoLock, nextCargoLock, 'utf8'),
  writeFile(files.metainfo, nextMetainfo, 'utf8'),
]);

assertInSync((await readVersions()).versions);
