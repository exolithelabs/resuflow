#!/usr/bin/env bash
#
# Builds the Arch Linux .pkg.tar.zst for ResuFlow from distro/arch/PKGBUILD.
#
# The CI build-linux job runs this inside an archlinux:base container; it also
# works on any Arch machine. The script installs the dependencies the PKGBUILD
# declares, verifies the release version, primes the vendored npm and Cargo
# caches that the package builds offline from, publishes those tarballs (the
# PKGBUILD input tarballs) with SHA-256 sidecars, and then hands the PKGBUILD to
# makepkg so CI and a manual `makepkg -s` produce the same package.
#
# Layout follows the Filesystem Hierarchy Standard: /usr/bin/resuflow plus a
# resuflow-cli alias, and the Node sidecar under /usr/lib/resuflow where the
# Tauri shell resolves its resource directory. No install scripts or hooks.
#
# Environment:
#   GITHUB_REF_NAME  release tag (vX.Y.Z) when publishing; otherwise the
#                    package.json version is used.
#   OUT_DIR          output directory (default: <repo>/dist/linux).
#   INSTALL_DEPS=1   let makepkg resolve dependencies through pacman (this needs
#                    sudo for a non-root user; CI pre-installs them as root).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/dist/linux}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cd "$REPO_ROOT"

# --- Dependencies -------------------------------------------------------------
# The PKGBUILD is the source of truth for the dependency list.
pkgbuild_field() {
  sed -n "/^$1=(/,/)/p" distro/arch/PKGBUILD | grep -oE "'[^']+'" | tr -d "'"
}
mapfile -t STACK_PACKAGES < <(printf '%s\n' base-devel git; pkgbuild_field depends; pkgbuild_field makedepends)

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}
for tool in node npm cargo rustc git tar sha256sum bsdtar fakeroot install ln sed grep awk; do
  require "$tool"
done

if [[ -f /etc/arch-release && "$(id -u)" -eq 0 ]]; then
  echo 'Installing Arch build dependencies…'
  # The base container can start with an unpopulated keyring, so refresh it first.
  pacman -Sy --noconfirm --needed archlinux-keyring >/dev/null
  pacman -Syu --noconfirm --needed "${STACK_PACKAGES[@]}"
fi

# --- Version ------------------------------------------------------------------
REF_NAME="${GITHUB_REF_NAME:-}"
if [[ "$REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  VERSION_CHECK_ARG="$REF_NAME"
  VERSION="${REF_NAME#v}"
else
  VERSION_CHECK_ARG=""
  VERSION="$(node -e "console.log(require('$REPO_ROOT/package.json').version)")"
fi
PKGREL="$(grep -E '^pkgrel=' distro/arch/PKGBUILD | cut -d= -f2)"

case "$(uname -m)" in
  x86_64) PACKAGE_ARCH=x86_64 ;;
  aarch64) PACKAGE_ARCH=aarch64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

echo "Building ResuFlow $VERSION (pkgrel $PKGREL) for $PACKAGE_ARCH…"
if [[ -n "$VERSION_CHECK_ARG" ]]; then
  npm run version:check -- "$VERSION_CHECK_ARG"
else
  npm run version:check
fi
npm run distro:check

mkdir -p "$OUT_DIR"

# Reproducible timestamps for the archives and for the package metadata.
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct 2>/dev/null || date +%s)"
export SOURCE_DATE_EPOCH

# --- Vendored caches (this is the only networked step) ------------------------
# The PKGBUILD builds without network access, so the caches are primed here and
# published with the source tarball as release assets.
NPM_CACHE="$WORK_DIR/npm-cache"
CARGO_HOME_DIR="$WORK_DIR/cargo-home"
export NPM_CONFIG_CACHE="$NPM_CACHE"
export CARGO_HOME="$CARGO_HOME_DIR"

echo 'Priming the npm cache…'
npm ci --omit=dev --ignore-scripts
echo 'Priming the Cargo cache…'
cargo fetch --locked --manifest-path src-tauri/Cargo.toml

# --- PKGBUILD input tarballs --------------------------------------------------
PKG_TARBALL="resuflow-$VERSION.tar.gz"
NPM_TARBALL="resuflow-$VERSION-npm-cache.tar.gz"
CARGO_TARBALL="resuflow-$VERSION-cargo-cache.tar.gz"

echo 'Packing the source and dependency tarballs…'
git archive --format=tar.gz --prefix="resuflow-$VERSION/" -o "$OUT_DIR/$PKG_TARBALL" HEAD
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$SOURCE_DATE_EPOCH" \
  -czf "$OUT_DIR/$NPM_TARBALL" -C "$WORK_DIR" npm-cache
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$SOURCE_DATE_EPOCH" \
  -czf "$OUT_DIR/$CARGO_TARBALL" -C "$WORK_DIR" cargo-home

# --- makepkg ------------------------------------------------------------------
# The checked-in PKGBUILD downloads those tarballs from the GitHub release and
# keeps sha256sums as SKIP, because the assets only exist after this run uploads
# them. The build copy therefore uses the tarballs created here and pins their
# real digests, so makepkg still verifies every input it compiles.
BUILD_DIR="$WORK_DIR/pkgbuild"
mkdir -p "$BUILD_DIR"
sed -E 's|::https://[^"[:space:]]*||g' distro/arch/PKGBUILD > "$BUILD_DIR/PKGBUILD"
cp "$OUT_DIR/$PKG_TARBALL" "$OUT_DIR/$NPM_TARBALL" "$OUT_DIR/$CARGO_TARBALL" "$BUILD_DIR/"

SHA256_FILE="$WORK_DIR/sha256sums.txt"
printf "sha256sums=('%s'\n            '%s'\n            '%s')\n" \
  "$(sha256sum "$BUILD_DIR/$PKG_TARBALL" | cut -d' ' -f1)" \
  "$(sha256sum "$BUILD_DIR/$NPM_TARBALL" | cut -d' ' -f1)" \
  "$(sha256sum "$BUILD_DIR/$CARGO_TARBALL" | cut -d' ' -f1)" > "$SHA256_FILE"

awk -v sums="$SHA256_FILE" '
  /^sha256sums=\(/ {
    while ((getline line < sums) > 0) print line
    close(sums)
    skip = 1
  }
  skip {
    if ($0 ~ /\)/) skip = 0
    next
  }
  { print }
' "$BUILD_DIR/PKGBUILD" > "$BUILD_DIR/PKGBUILD.pinned"
mv "$BUILD_DIR/PKGBUILD.pinned" "$BUILD_DIR/PKGBUILD"
if ! grep -qE "sha256sums=\('[0-9a-f]{64}'" "$BUILD_DIR/PKGBUILD"; then
  echo 'Failed to pin the PKGBUILD checksums.' >&2
  exit 1
fi

# The unprivileged makepkg call below passes these paths inside a shell string.
if [[ "$WORK_DIR" == *' '* || "$OUT_DIR" == *' '* ]]; then
  echo 'This script requires paths without whitespace.' >&2
  exit 1
fi

DEP_FLAG='--nodeps'
if [[ "${INSTALL_DEPS:-0}" == '1' ]]; then
  DEP_FLAG='--syncdeps'
fi

if [[ "$(id -u)" -eq 0 ]]; then
  # makepkg refuses to run as root, which is how the CI container starts.
  BUILD_USER="${BUILD_USER:-resuflow-builder}"
  if ! id -u "$BUILD_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$BUILD_USER"
  fi
  chown -R "$BUILD_USER" "$WORK_DIR" "$OUT_DIR"
  echo "Running makepkg as $BUILD_USER…"
  runuser -u "$BUILD_USER" -- env SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH" PKGDEST="$OUT_DIR" \
    bash -c "cd '$BUILD_DIR' && makepkg --noconfirm --clean $DEP_FLAG"
else
  ( cd "$BUILD_DIR" && PKGDEST="$OUT_DIR" makepkg --noconfirm --clean "$DEP_FLAG" )
fi

# --- Output -------------------------------------------------------------------
PKG_FILE="resuflow-$VERSION-$PKGREL-$PACKAGE_ARCH.pkg.tar.zst"
if [[ ! -f "$OUT_DIR/$PKG_FILE" ]]; then
  echo "makepkg did not produce $PKG_FILE." >&2
  exit 1
fi

echo 'Writing checksums…'
( cd "$OUT_DIR" && sha256sum "$PKG_FILE" "$PKG_TARBALL" "$NPM_TARBALL" "$CARGO_TARBALL" > "$WORK_DIR/all-sha256.txt" )
while read -r hash name; do
  printf '%s  %s\n' "$hash" "$name" > "$OUT_DIR/$name.sha256"
done < "$WORK_DIR/all-sha256.txt"

echo "PACKAGE_FILE=$OUT_DIR/$PKG_FILE"
echo "SOURCE_TARBALL=$OUT_DIR/$PKG_TARBALL"
echo "Done: $OUT_DIR/$PKG_FILE"
