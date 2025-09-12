import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.resolve(__dirname, 'src/manifest.json');
const raw = await fs.promises.readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw);

function incVersion(v) {
  const parts = v.split('.').map(Number);
  if (parts.length < 3) return '1.0.0';
  parts[2]++;
  if (parts[2] >= 10) {
    parts[2] = 0;
    parts[1]++;
  }
  return parts.join('.');
}

manifest.version = incVersion(manifest.version);

await fs.promises.writeFile(
  manifestPath,
  JSON.stringify(manifest, null, 2)
);

console.log('New manifest version:', manifest.version);
