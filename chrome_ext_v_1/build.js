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

// copy static files
await fs.copy('src/manifest.json', 'dist/manifest.json');
await fs.copy('src/popup.html', 'dist/popup.html');
await fs.copy('src/popup.css', 'dist/popup.css');

// main entry points (bundled normally)
const ENTRY_POINTS = {
  content: 'src/content.js',
  bettor: 'src/bettor.js',
  popup: 'src/popup.js',
  bg: 'src/bg.js',
};

// separate “global” bundle so manifest/popup can load bet-config.js directly
const GLOBAL_ENTRY = {
  'bet-config': 'src/bet-config.js',
};

// ---- one-off build mode ----
async function buildOnce() {
  // 1) build normal entries
  await esbuild.build({
    entryPoints: ENTRY_POINTS,
    outdir: 'dist',
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
  });

  // 2) build global BetConfig (window.BetConfig = {...})
  await esbuild.build({
    entryPoints: GLOBAL_ENTRY,
    outdir: 'dist',
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
    globalName: 'BetConfig', // exposes named exports on window.BetConfig
  });

  // 3) optional obfuscation
  if (OBFUSCATE) {
    const FILES_TO_OBFUSCATE = [
      'content.js',
      'bettor.js',
      'popup.js',
      'bg.js',
      'bet-config.js', // include the global bundle too
    ];
    for (const name of FILES_TO_OBFUSCATE) {
      const file = `dist/${name}`;
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

// ---- watch mode ----
async function watchMode() {
  // normal entries
  const ctxMain = await esbuild.context({
    entryPoints: ENTRY_POINTS,
    outdir: 'dist',
    bundle: true,
    minify: false,
    sourcemap: true,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
  });

  // global bet-config
  const ctxGlobal = await esbuild.context({
    entryPoints: GLOBAL_ENTRY,
    outdir: 'dist',
    bundle: true,
    minify: false,
    sourcemap: true,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
    globalName: 'BetConfig',
  });

  await Promise.all([ctxMain.watch(), ctxGlobal.watch()]);
  console.log('Watching… Load dist/ as the extension.');
}

if (isWatch) {
  await watchMode();
} else {
  await buildOnce();
}
