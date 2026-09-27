// Validates distro/arch/PKGBUILD against the workspace manifests and the
// AppStream metainfo. Tauri does not emit Pacman packages for this project,
// so a hand-written PKGBUILD plus generated .SRCINFO is the source of truth
// and both are checked in.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgbuildPath = path.join(repoRoot, 'distro', 'arch', 'PKGBUILD');
const srcinfoPath = path.join(repoRoot, 'distro', 'arch', '.SRCINFO');
const metainfoPath = path.join(repoRoot, 'distro', 'linux', 'io.github.exolithelabs.ResuFlow.metainfo.xml');
const desktopPath = path.join(repoRoot, 'distro', 'linux', 'resuflow.desktop');

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const pkgbuild = readFileSync(pkgbuildPath, 'utf8');
const srcinfo = readFileSync(srcinfoPath, 'utf8');
const metainfo = readFileSync(metainfoPath, 'utf8');
const desktop = readFileSync(desktopPath, 'utf8');

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

function gitGrep(pattern) {
  try {
    return execFileSync(
      'git',
      ['grep', '-l', pattern, '--', '.', ':!scripts/distro-check.mjs'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches.
    return String(error.stdout || '').trim();
  }
}

function gitGrepLines(pattern) {
  try {
    return execFileSync(
      'git',
      ['grep', '-n', '-e', pattern, '--', '.', ':!scripts/distro-check.mjs'],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches.
    return String(error.stdout || '').trim();
  }
}

// --- PKGBUILD vs manifests ---
const version = String(packageJson.version);
const pkgver = pkgbuild.match(/^pkgver=([^\s]+)/m)?.[1];
const pkgrel = pkgbuild.match(/^pkgrel=(\d+)/m)?.[1];
check(new RegExp(`^pkgver=${version.replaceAll('.', '\\.')}$`, 'm').test(pkgbuild), `PKGBUILD pkgver must match package.json version (${version}).`);
check(pkgrel === '1', 'PKGBUILD pkgrel must be 1 so rebuilds of the same version keep a stable filename.');

check(pkgbuild.includes("arch=('x86_64' 'aarch64')"), 'PKGBUILD arch must be x86_64 and aarch64.');

const tarball = `resuflow-${version}.tar.gz`;
const npmCache = `resuflow-${version}-npm-cache.tar.gz`;
const cargoCache = `resuflow-${version}-cargo-cache.tar.gz`;
for (const source of [`resuflow-\${pkgver}.tar.gz`, `resuflow-\${pkgver}-npm-cache.tar.gz`, `resuflow-\${pkgver}-cargo-cache.tar.gz`]) {
  check(pkgbuild.includes(source), `PKGBUILD source array must reference ${source}.`);
}
for (const filename of [tarball, npmCache, cargoCache]) {
  check(srcinfo.includes(`${filename}::https://github.com/exolithelabs/resuflow/releases/download/v${version}/${filename}`), `.SRCINFO must reference ${filename} from the release assets.`);
}

const binary = 'src-tauri/target/release/${pkgname}';
check(pkgbuild.includes(`install -Dm755 "${binary}" "\${pkgdir}/usr/bin/\${pkgname}"`), 'PKGBUILD must install the Tauri binary to /usr/bin/resuflow.');
check(pkgbuild.includes('usr/lib/${pkgname}'), 'PKGBUILD must stage the sidecar under /usr/lib/resuflow.');
check(pkgbuild.includes('distro/linux/resuflow.desktop'), 'PKGBUILD must install distro/linux/resuflow.desktop.');
check(pkgbuild.includes('distro/linux/io.github.exolithelabs.ResuFlow.metainfo.xml'), 'PKGBUILD must install the AppStream metainfo file.');

for (const dependency of ['webkit2gtk-4.1', 'gtk3', 'libsoup3', 'cairo', 'pango', 'gdk-pixbuf2', 'glib2', 'hicolor-icon-theme', 'desktop-file-utils', 'xdg-utils']) {
  check(new RegExp(`^depends=\\(.*'${dependency}'`, 'ms').test(pkgbuild) || pkgbuild.includes(`'${dependency}'`), `PKGBUILD depends must include ${dependency}.`);
}
for (const dependency of ['cargo', 'librsvg', 'nodejs', 'npm', 'patchelf']) {
  check(new RegExp(`^makedepends=\\(.*'${dependency}'`, 'ms').test(pkgbuild) || pkgbuild.includes(`'${dependency}'`), `PKGBUILD makedepends must include ${dependency}.`);
}

// --- .SRCINFO vs PKGBUILD ---
for (const [field, value] of [['pkgver', pkgver], ['pkgrel', pkgrel], ['arch = x86_64', 'x86_64'], ['arch = aarch64', 'aarch64']]) {
  check(srcinfo.includes(`${field}${field.startsWith('arch') ? '' : ' = '}${field.startsWith('arch') ? '' : value}`), `.SRCINFO must carry ${field}${field.startsWith('arch') ? '' : ` = ${value}`}.`);
}
check(srcinfo.includes('pkgbase = resuflow') && srcinfo.includes('pkgname = resuflow'), '.SRCINFO must declare pkgbase and pkgname resuflow.');

// --- AppStream metainfo ---
check(metainfo.includes('<id>io.github.exolithelabs.ResuFlow</id>'), 'Metainfo id must be io.github.exolithelabs.ResuFlow.');
check(metainfo.includes('project_license>Apache-2.0</project_license') && metainfo.includes('https://github.com/exolithelabs/resuflow'), 'Metainfo project_license/homepage must reference exolithelabs/resuflow.');
check(metainfo.includes('<launchable type="desktop-id">resuflow.desktop</launchable>'), 'Metainfo must launch resuflow.desktop.');
for (const iconSize of ['32', '128', '512']) {
  check(metainfo.includes(`width="${iconSize}"`), `Metainfo should reference a ${iconSize}px icon.`);
}

// --- Desktop entry ---
check(desktop.includes('Name=ResuFlow') && desktop.includes('Exec=resuflow'), 'Desktop entry must launch resuflow with the ResuFlow name.');
check(desktop.includes('Icon=resuflow'), 'Desktop entry must reference the resuflow icon theme name.');
const metainfoRelease = metainfo.match(/<release\s+version="([^"]+)"/)?.[1];
check(metainfoRelease === version, `Metainfo must list a <release version="${version}"/> entry as the newest release (found ${metainfoRelease || 'none'}).`);
check(!desktop.toLowerCase().includes('resume-builder'), 'Desktop entry must not reference the old distribution.');

// Guard against the retired shared Flatpak distribution returning.
for (const pattern of ['flatpak.exolithelabs', 'exolithelabs-flatpak-repo', 'FLATPAK_', '.flatpakref']) {
  const hits = gitGrep(pattern);
  check(hits === '', `Tracked files must not mention retired pattern ${pattern}, found: ${hits || '(none)'}.`);
}

// Guard against the retired portable .tar.zst + install.sh distribution returning.
for (const pattern of ['build-linux-tarball', 'linux/install.sh', 'linux/uninstall.sh', '~/.local']) {
  const hits = gitGrep(pattern);
  check(hits === '', `Tracked files must not mention retired pattern ${pattern}, found: ${hits || '(none)'}.`);
}

// Every tracked .tar.zst reference must be the pacman package.
const tarballRefs = gitGrepLines('.tar.zst')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes('.pkg.tar.zst'));
check(tarballRefs.length === 0, `Tracked files must only reference the pacman .pkg.tar.zst, found: ${tarballRefs.join('; ') || '(none)'}.`);

if (failures.length > 0) {
  console.error(`Distro packaging check failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`Distro packaging matches version ${version} (PKGBUILD, .SRCINFO, metainfo, desktop).`);
