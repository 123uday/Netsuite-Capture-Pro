import { readFile, access, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.background.type !== 'module') {
  throw new Error('Expected a Manifest V3 extension with a module service worker.');
}
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(['activeTab', 'downloads', 'scripting'])) {
  throw new Error('Unexpected Phase 2 permissions.');
}
const paths = [manifest.background.service_worker, manifest.action.default_popup,
  'content/scroll-detector.js', 'content/scrollbar-cleanup.js', 'content/content.js',
  'content/element-selector.js', 'content/element-content.js',
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])])];
for (const path of paths) await access(resolve(root, path));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}
const files = await walk(root);
for (const path of ['content/scroll-detector.js', 'content/scrollbar-cleanup.js', 'content/content.js', 'content/element-selector.js', 'content/element-content.js']) {
  const source = await readFile(resolve(root, path), 'utf8');
  if (/^\s*(import|export)\s/m.test(source)) throw new Error(`Classic content script contains module syntax: ${path}`);
}
for (const file of files.filter((path) => /\.(m?js)$/.test(path))) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
    await access(resolve(dirname(file), match[1]));
  }
}
const popupFile = resolve(root, manifest.action.default_popup);
const popup = await readFile(popupFile, 'utf8');
for (const match of popup.matchAll(/(?:src|href)="([^"]+)"/g)) {
  await access(resolve(dirname(popupFile), match[1]));
}
console.log(`Validated Manifest V3 paths, popup assets, local imports and JavaScript syntax (${files.length} files).`);
console.log(`No bundling required. Load unpacked: ${relative(process.cwd(), root) || '.'}${sep}`);
