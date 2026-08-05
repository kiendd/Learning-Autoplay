import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const zipName = `linkedin-learning-auto-resume-${version}.zip`;
const zipPath = join(root, 'dist', zipName);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test('the zip users download exists for the current version', () => {
  assert.ok(existsSync(zipPath), `${zipName} is missing — run: npm run build`);
});

// The install guide links straight to a versioned filename. Bumping the version
// without rebuilding leaves that link pointing at nothing, which is the one
// broken link that stops someone installing at all.
test('the install guide links to the zip that exists', () => {
  const guide = readFileSync(join(root, 'INSTALL.md'), 'utf8');
  const linked = [...guide.matchAll(/dist\/([^)\s\]([]+\.zip)/g)].map((m) => m[1]);

  assert.ok(linked.length > 0, 'INSTALL.md links to no zip at all');
  for (const name of new Set(linked)) {
    assert.equal(name, zipName, `INSTALL.md links to ${name}, but the build produces ${zipName}`);
  }
});

// A zip built before the last edit ships users code that no longer exists here.
test('the zip contents match the current source', () => {
  const packed = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line && !line.endsWith('/'));

  const expected = ['manifest.json', ...walk(join(root, 'src')).map((f) => relative(root, f))].sort();
  const actual = packed.map((line) => line.replace(/^[^/]+\//, '')).sort();
  assert.deepEqual(actual, expected, 'the zip holds a different set of files — run: npm run build');

  for (const file of expected) {
    const inZip = execFileSync(
      'unzip',
      ['-p', zipPath, `linkedin-learning-auto-resume-${version}/${file}`],
      { encoding: 'utf8' },
    );
    assert.equal(inZip, readFileSync(join(root, file), 'utf8'), `${file} in the zip is stale — run: npm run build`);
  }
});
