import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(frontendRoot, 'public');
const sourceSvg = path.join(publicRoot, 'whatson-logo.svg');
const background = '#0B0C0F';

const pngOutputs = [
  ['apple-touch-icon.png', 180],
  ['logo192.png', 192],
  ['logo512.png', 512],
  ['whatson-logo.png', 1024],
];

async function renderPng(size) {
  return sharp(sourceSvg, { density: 1024 })
    .resize(size, size)
    .flatten({ background })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const rendered = await Promise.all(
    pngOutputs.map(async ([fileName, size]) => {
      const buffer = await renderPng(size);
      await fs.writeFile(path.join(publicRoot, fileName), buffer);
      return [fileName, buffer];
    })
  );

  const pngByName = new Map(rendered);
  const icoBuffer = await pngToIco([
    await renderPng(16),
    await renderPng(32),
    await renderPng(48),
  ]);
  await fs.writeFile(path.join(publicRoot, 'favicon.ico'), icoBuffer);

  await Promise.all(
    pngOutputs.map(async ([fileName]) => {
      const stats = await fs.stat(path.join(publicRoot, fileName));
      if (!stats.size || !pngByName.get(fileName)) {
        throw new Error(`Failed to generate ${fileName}`);
      }
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
