// build.mjs (ESM)
import esbuild from 'esbuild';
import fs from 'fs-extra';
import obfuscator from 'javascript-obfuscator';
const { obfuscate } = obfuscator;

const isWatch = process.argv.includes('--watch');
const OBFUSCATE = process.env.OBFUSCATE === '1';

// clean dist
await fs.rm('dist', { recursive: true, force: true });
await fs.mkdir('dist', { recursive: true });

// copy statics
await fs.copy('src/manifest.json', 'dist/manifest.json');
await fs.copy('src/popup.html', 'dist/popup.html');
await fs.copy('src/popup.css', 'dist/popup.css');

// entries (сохраняем структуру src → dist)
const ENTRY_POINTS = [
  'src/content.js',
  'src/bg.js',
  'src/popup.js',
  'src/auto/engine.js',
  'src/auto/market-base.js',
  'src/auto/dozens.js',
  'src/auto/rows.js',
  'src/auto/combo.js',
  'src/auto/sixlines.js',
  'src/auto/threes.js',
  'src/auto/colors.js',
  'src/auto/evenodd.js',
  'src/auto/lowhigh.js',
  'src/auto/sectors.js',
  'src/auto/neighbors.js',
  'src/auto/anti-dozens.js',
  'src/auto/anti-rows.js',
  'src/auto/numbers.js',
  'src/auto/missing19.js',
];

const BASE = {
  entryPoints: ENTRY_POINTS,
  outdir: 'dist',
  outbase: 'src',
  entryNames: '[dir]/[name]',
  bundle: true,
  target: ['chrome120'],
  format: 'iife',
  platform: 'browser',
  logLevel: 'info',
};

async function buildOnce() {
  await esbuild.build({ ...BASE, minify: true, sourcemap: false });

  if (OBFUSCATE) {
    const files = ENTRY_POINTS.map((p) =>
      p.replace(/^src\//, 'dist/')
    );
    for (const file of files) {
      const code = await fs.readFile(file, 'utf8');
      const obf = obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        deadCodeInjection: true,
        identifierNamesGenerator: 'mangled-shuffled',
        numbersToExpressions: true,
        simplify: true,
        splitStrings: true,
        stringArray: true,
        stringArrayThreshold: 0.75,
        transformObjectKeys: true,
      }).getObfuscatedCode();
      await fs.writeFile(file, obf, 'utf8');
    }
  }

  console.log('Built → dist/');
}

async function watchMode() {
  const ctx = await esbuild.context({
    ...BASE,
    minify: false,
    sourcemap: true,
  });
  await ctx.watch();
  console.log('Watching… Load dist/ as the extension.');
}

if (isWatch) await watchMode();
else await buildOnce();
