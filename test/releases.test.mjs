import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLatestRelease, compareVersions } from '../src/releases.mjs';

test('compares stable and prerelease semantic versions', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.1'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0-beta.2'), 1);
});

test('recognizes a newer valid GitHub release', async () => {
  const result = await checkLatestRelease({
    currentVersion: '1.0.0',
    useCache: false,
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: 'v1.1.0',
      name: 'ResuFlow 1.1.0',
      html_url: 'https://github.com/exolithelabs/resuflow/releases/tag/v1.1.0',
      published_at: '2026-09-12T00:00:00Z',
    })),
  });

  assert.equal(result.available, true);
  assert.equal(result.latestVersion, '1.1.0');
});

test('rejects release links outside the official repository', async () => {
  await assert.rejects(() => checkLatestRelease({
    currentVersion: '1.0.0',
    useCache: false,
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: 'v9.0.0',
      html_url: 'https://example.com/fake-release',
    })),
  }), /invalid release payload/);
});
