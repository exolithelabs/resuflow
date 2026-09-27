import test from 'node:test';
import assert from 'node:assert/strict';

// Isolate the module from any environment-overridable URLs so the assertions
// below always exercise the documented defaults.
delete process.env.RESUFLOW_DOWNLOAD_URL;
delete process.env.RESUFLOW_PACKAGE_URL;
const {
  installApp,
  LINUX_PACKAGE_FILE,
  LINUX_PACKAGE_URL,
  uninstallApp,
  updateApp,
} = await import('../src/lifecycle.mjs');

function captureOutput(call) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    const code = call();
    return { code, output: lines.join('\n') };
  } finally {
    console.log = originalLog;
  }
}

test('linux package constants point at the pacman release assets', () => {
  assert.match(LINUX_PACKAGE_FILE, /\.pkg\.tar\.zst$/);
  assert.match(LINUX_PACKAGE_URL, /^https:\/\/github\.com\/exolithelabs\/resuflow\/releases\/latest\/download\//);
});

test('install copy covers the URL and local-file pacman flows', () => {
  const { code, output } = captureOutput(() => installApp());
  assert.equal(code, 0);
  assert.match(output, /pacman -U .*https:\/\//);
  assert.match(output, /pacman -U \.\//);
});

test('update copy presents both flows as upgrades', () => {
  const { code, output } = captureOutput(() => updateApp());
  assert.equal(code, 0);
  assert.match(output, /upgrade/i);
  assert.match(output, /pacman -U/);
});

test('uninstall copy keeps workspaces and uses the platform method', () => {
  const { code, output } = captureOutput(() => uninstallApp());
  assert.equal(code, 0);
  assert.match(output, /not removed/i);
  // Only Windows and Linux (Arch) are supported targets; other platforms get
  // no pacman-specific expectation.
  if (process.platform === 'win32') {
    assert.match(output, /Settings/);
  } else if (process.platform === 'linux') {
    assert.match(output, /pacman -Rns/);
  }
});
