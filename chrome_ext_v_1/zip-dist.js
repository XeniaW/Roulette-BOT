import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, 'dist');
const buildsDir = path.resolve(__dirname, 'builds');
const manifestPath = path.resolve(distDir, 'manifest.json');

function safeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

if (!fs.existsSync(distDir)) {
  throw new Error('dist/ not found. Run npm run build first.');
}

if (!fs.existsSync(manifestPath)) {
  throw new Error('dist/manifest.json not found. Run npm run build first.');
}

const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
const name = safeFilePart(manifest.name || 'extension');
const version = safeFilePart(manifest.version || '0.0.0');
const zipPath = path.join(buildsDir, `${name} ${version}.zip`);

await fs.promises.mkdir(buildsDir, { recursive: true });
await fs.promises.rm(zipPath, { force: true });

const command = [
  '$ErrorActionPreference = "Stop";',
  `Compress-Archive -Path ${JSON.stringify(path.join(distDir, '*'))} -DestinationPath ${JSON.stringify(zipPath)} -Force;`,
].join(' ');

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
  { cwd: __dirname, stdio: 'inherit' },
);

if (result.status !== 0) {
  throw new Error(`Zip failed with exit code ${result.status ?? 'unknown'}`);
}

console.log(`Packed -> ${path.relative(__dirname, zipPath)}`);
