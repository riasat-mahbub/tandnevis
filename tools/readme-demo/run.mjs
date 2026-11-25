import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { captureActions, installPointer } from './actions.mjs';
import outline from './outline.test.mjs';
import sceneWriting from './scene-writing.test.mjs';
import library from './library.test.mjs';
import characterCreation from './character-creation.test.mjs';
import relationships from './relationships.test.mjs';
import compile from './compile.test.mjs';

const features = new Map([
  ['outline', outline],
  ['scene-writing', sceneWriting],
  ['library', library],
  ['character-creation', characterCreation],
  ['relationships', relationships],
  ['compile', compile],
]);
const viewport = { width: 1440, height: 960 };
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'out');

function ffmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', error => reject(new Error('Could not launch FFmpeg. Install it and add it to PATH.', { cause: error })));
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed (${signal ?? code}).`));
    });
  });
}

async function runFeature(browser, url, flow, clip) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  try {
    page.setDefaultTimeout(5000);
    await page.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
    await page.goto(url.href, { waitUntil: 'load', timeout: 15000 });
    await page.getByRole('main', { name: 'Story canvas' }).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const recording = Boolean(clip);
    if (recording) await installPointer(page);
    let started = false;
    const start = async () => {
      if (recording) await page.screencast.start({ path: clip, size: viewport, quality: 92 });
      started = true;
    };
    await flow({ page, start, recording, ...captureActions(recording) });
    if (!started) throw new Error('The feature did not start its capture.');
    if (errors.length) throw new AggregateError(errors, 'The app reported an uncaught error.');
    if (recording) await page.screencast.stop();
  } finally {
    await context.close();
  }
}

async function encode(work, clips) {
  await writeFile(join(work, 'clips.txt'), clips.map(clip => `file '${clip}'\n`).join(''));
  await ffmpeg([
    '-f', 'concat', '-i', 'clips.txt', '-an', '-c:v', 'libx264', '-threads', '2',
    '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'feature-tour.mp4',
  ], work);
  await ffmpeg([
    '-i', 'feature-tour.mp4', '-filter_complex_threads', '2',
    '-filter_complex', 'fps=6,scale=1080:-2:flags=lanczos,mpdecimate,split[a][b];[a]palettegen=max_colors=80[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-final_delay', '100', '-loop', '0', 'feature-tour.gif',
  ], work);
  await rename(join(work, 'feature-tour.mp4'), join(output, 'readme-demo.mp4'));
  await rename(join(work, 'feature-tour.gif'), join(root, 'assets', 'feature-tour.gif'));
}

async function main() {
  const { values, positionals } = parseArgs({ options: { check: { type: 'boolean' } }, allowPositionals: true });
  if (positionals.length && (!values.check || positionals.some(name => !features.has(name)))) {
    throw new Error(`To check selected flows, use --check with any of: ${[...features.keys()].join(', ')}.`);
  }
  const selected = positionals.length ? new Set(positionals) : new Set(features.keys());
  const recording = !values.check;
  if (recording) {
    await ffmpeg(['-version'], root);
    await mkdir(output, { recursive: true });
  }
  const work = recording ? await mkdtemp(join(output, 'readme-demo-')) : undefined;
  let server;
  let browser;
  try {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: false, hmr: false } });
    await server.listen();
    const url = new URL('/tools/readme-demo/index.html', server.resolvedUrls.local[0]);
    browser = await chromium.launch();
    const clips = [];
    for (const name of selected) {
      const clip = `${name}.webm`;
      console.log(`${recording ? 'Recording' : 'Checking'} ${name}`);
      try {
        await runFeature(browser, url, features.get(name), work && join(work, clip));
      } catch (error) {
        throw new Error(`README demo flow failed: ${name}`, { cause: error });
      }
      clips.push(clip);
    }
    if (work) {
      await encode(work, clips);
      console.log('Updated assets/feature-tour.gif and out/readme-demo.mp4');
    } else {
      console.log(`Passed ${selected.size} README demo flows.`);
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        await server?.close();
      } finally {
        if (work) await rm(work, { recursive: true, force: true });
      }
    }
  }
}

await main();
