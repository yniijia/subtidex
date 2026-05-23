import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(process.cwd());

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  // eslint-disable-next-line no-console
  console.log(`✓ ${message}`);
}

function assertFile(relPath) {
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) fail(`Missing file: ${relPath}`);
  else pass(`Found: ${relPath}`);
}

function assertJson(relPath) {
  const absPath = path.join(repoRoot, relPath);
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    JSON.parse(raw);
    pass(`Valid JSON: ${relPath}`);
  } catch (e) {
    fail(`Invalid JSON: ${relPath}`);
  }
}

assertJson('manifest.json');
assertFile('background.js');
assertFile('content.js');
assertFile('innertube-extract.js');
assertFile('popup.html');
assertFile('popup.js');
assertFile('error.html');
assertFile('ui/tidal.css');
assertFile('icons/icon16.png');
assertFile('icons/icon48.png');
assertFile('icons/icon128.png');
assertFile('icons/icon.svg');

if (!process.exitCode) pass('All checks passed.');
