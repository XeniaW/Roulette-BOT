import esbuild from 'esbuild';
import fs from 'fs-extra';
import obfuscator from 'javascript-obfuscator';
const { obfuscate } = obfuscator;

const isWatch = process.argv.includes('--watch');
const OBFUSCATE = process.env.OBFUSCATE === '1';

await fs.rm('dist', { recursive: true, force: true });
await fs.mkdir('dist', { recursive: true });

// Copy static files
await fs.copy('src/manifest.json', 'dist/manifest.json');
await fs.copy('src/popup.html', 'dist/popup.html');
await fs.copy('src/popup.css', 'dist/popup.css');

// Bundle JS
async function buildOnce() {
  const ctx = await esbuild.build({
    entryPoints: {
      content: 'src/content.js',
      popup: 'src/popup.js',
      bg: 'src/bg.js',
    },
    outdir: 'dist',
    bundle: true,
    minify: true,
    sourcemap: false,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
  });

  if (OBFUSCATE) {
    for (const name of ['content.js', 'popup.js', 'bg.js']) {
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

  return ctx;
}

if (isWatch) {
  const build = await esbuild.context({
    entryPoints: {
      content: 'src/content.js',
      popup: 'src/popup.js',
      bg: 'src/bg.js',
    },
    outdir: 'dist',
    bundle: true,
    minify: false,
    sourcemap: true,
    target: ['chrome120'],
    format: 'iife',
    platform: 'browser',
    logLevel: 'info',
  });
  await build.watch();
  console.log('Watching… Load dist/ as the extension.');
} else {
  await buildOnce();
  console.log('Built → dist/');
}
