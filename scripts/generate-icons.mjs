import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSvg = path.join(repoRoot, 'design', 'whatson-icon.svg');

const iosIconDir = path.join(repoRoot, 'WhatsOn', 'Assets.xcassets', 'AppIcon.appiconset');
const webPublicDir = path.join(repoRoot, 'web-frontend', 'public');

const pngOutputs = [
  { file: path.join(iosIconDir, 'AppIcon.png'), size: 1024 },
  { file: path.join(iosIconDir, 'Icon-iphone-20x20-2x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-iphone-20x20-3x.png'), size: 60 },
  { file: path.join(iosIconDir, 'Icon-iphone-29x29-2x.png'), size: 58 },
  { file: path.join(iosIconDir, 'Icon-iphone-29x29-3x.png'), size: 87 },
  { file: path.join(iosIconDir, 'Icon-iphone-40x40-2x.png'), size: 80 },
  { file: path.join(iosIconDir, 'Icon-iphone-40x40-3x.png'), size: 120 },
  { file: path.join(iosIconDir, 'Icon-iphone-60x60-2x.png'), size: 120 },
  { file: path.join(iosIconDir, 'Icon-iphone-60x60-3x.png'), size: 180 },
  { file: path.join(iosIconDir, 'Icon-ipad-20x20-1x.png'), size: 20 },
  { file: path.join(iosIconDir, 'Icon-ipad-20x20-2x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-ipad-29x29-1x.png'), size: 29 },
  { file: path.join(iosIconDir, 'Icon-ipad-29x29-2x.png'), size: 58 },
  { file: path.join(iosIconDir, 'Icon-ipad-40x40-1x.png'), size: 40 },
  { file: path.join(iosIconDir, 'Icon-ipad-40x40-2x.png'), size: 80 },
  { file: path.join(iosIconDir, 'Icon-ipad-76x76-1x.png'), size: 76 },
  { file: path.join(iosIconDir, 'Icon-ipad-76x76-2x.png'), size: 152 },
  { file: path.join(iosIconDir, 'Icon-ipad-83_5x83_5-2x.png'), size: 167 },
  { file: path.join(webPublicDir, 'apple-touch-icon.png'), size: 180 },
  { file: path.join(webPublicDir, 'logo192.png'), size: 192 },
  { file: path.join(webPublicDir, 'logo512.png'), size: 512 },
  { file: path.join(webPublicDir, 'whatson-logo.png'), size: 1024 },
];

async function buildOpaquePng(size) {
  return sharp(sourceSvg)
    .resize(size, size, { fit: 'fill' })
    .flatten({ background: '#0B0C0F' })
    .removeAlpha()
    .png()
    .toBuffer();
}

for (const output of pngOutputs) {
  const png = await buildOpaquePng(output.size);
  await fs.writeFile(output.file, png);
}

// Sizes mirror the `favicon.ico` entry in web-frontend/public/manifest.json.
const faviconPngs = await Promise.all([16, 32, 48, 64].map((size) => buildOpaquePng(size)));
const faviconIco = await pngToIco(faviconPngs);
await fs.writeFile(path.join(webPublicDir, 'favicon.ico'), faviconIco);

console.log(`Generated ${pngOutputs.length} PNG files and favicon.ico from ${path.relative(repoRoot, sourceSvg)}`);
