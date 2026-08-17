import fs from 'fs';
import path from 'path';

const webRoot = process.cwd();
const repoRoot = path.resolve(webRoot, '..');
const publicRoot = path.join(webRoot, 'public');
const iosIconRoot = path.join(repoRoot, 'WhatsOn', 'Assets.xcassets', 'AppIcon.appiconset');
const layeredIconRoot = path.join(repoRoot, 'WhatsOn', 'WhatsOn.icon');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPngMeta(filePath) {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  const chunkType = buf.subarray(12, 16).toString('ascii');
  expect(chunkType).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

function readIcoSizes(filePath) {
  const buf = fs.readFileSync(filePath);
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + (i * 16);
    const width = buf[offset] || 256;
    const height = buf[offset + 1] || 256;
    sizes.push(`${width}x${height}`);
  }
  return sizes;
}

function pointsToPixels(size, scale) {
  return Math.round(parseFloat(size.split('x')[0]) * parseInt(scale, 10));
}

describe('brand icon assets', () => {
  it('keeps the web manifest and HTML icon references in sync', () => {
    const manifest = readJson(path.join(publicRoot, 'manifest.json'));
    const indexHtml = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');

    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: 'logo192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: 'logo512.png', sizes: '512x512', type: 'image/png' }),
        expect.objectContaining({ src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }),
      ])
    );
    expect(indexHtml).toContain('%PUBLIC_URL%/favicon.ico');
    expect(indexHtml).toContain('sizes="180x180"');
    expect(indexHtml).toContain('%PUBLIC_URL%/apple-touch-icon.png');
    expect(indexHtml).toContain('content="#AA4C0C"');
  });

  it('ships opaque web icon assets generated from the SVG source', () => {
    expect(fs.existsSync(path.join(publicRoot, 'whatson-logo.svg'))).toBe(true);
    expect(readPngMeta(path.join(publicRoot, 'whatson-logo.png'))).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
    expect(readPngMeta(path.join(publicRoot, 'logo192.png'))).toMatchObject({ width: 192, height: 192, colorType: 2 });
    expect(readPngMeta(path.join(publicRoot, 'logo512.png'))).toMatchObject({ width: 512, height: 512, colorType: 2 });
    expect(readPngMeta(path.join(publicRoot, 'apple-touch-icon.png'))).toMatchObject({ width: 180, height: 180, colorType: 2 });
    expect(readIcoSizes(path.join(publicRoot, 'favicon.ico'))).toEqual(
      expect.arrayContaining(['16x16', '32x32', '48x48'])
    );
  });

  it('defines a complete iOS fallback app icon set with a non-alpha marketing icon', () => {
    const contents = readJson(path.join(iosIconRoot, 'Contents.json'));
    const expectedEntries = [
      ['iphone', '20x20', '2x'], ['iphone', '20x20', '3x'],
      ['iphone', '29x29', '2x'], ['iphone', '29x29', '3x'],
      ['iphone', '40x40', '2x'], ['iphone', '40x40', '3x'],
      ['iphone', '60x60', '2x'], ['iphone', '60x60', '3x'],
      ['ipad', '20x20', '1x'], ['ipad', '20x20', '2x'],
      ['ipad', '29x29', '1x'], ['ipad', '29x29', '2x'],
      ['ipad', '40x40', '1x'], ['ipad', '40x40', '2x'],
      ['ipad', '76x76', '1x'], ['ipad', '76x76', '2x'],
      ['ipad', '83.5x83.5', '2x'],
      ['ios-marketing', '1024x1024', '1x'],
    ];

    expectedEntries.forEach(([idiom, size, scale]) => {
      const entry = contents.images.find((image) => image.idiom === idiom && image.size === size && image.scale === scale);
      expect(entry).toBeTruthy();
      const meta = readPngMeta(path.join(iosIconRoot, entry.filename));
      const pixels = pointsToPixels(size, scale);
      expect(meta.width).toBe(pixels);
      expect(meta.height).toBe(pixels);
    });

    const marketingEntry = contents.images.find((image) => image.idiom === 'ios-marketing');
    const marketingIcon = readPngMeta(path.join(iosIconRoot, marketingEntry.filename));
    expect(marketingIcon.colorType).toBe(2);
  });

  it('includes the layered Liquid Glass source artwork for the iOS 26 icon bundle', () => {
    const manifest = readJson(path.join(layeredIconRoot, 'icon.json'));
    const background = manifest.layers.find((layer) => layer.role === 'background');
    const foreground = manifest.layers.find((layer) => layer.role === 'foreground');

    expect(background).toBeTruthy();
    expect(foreground).toBeTruthy();
    expect(fs.existsSync(path.join(layeredIconRoot, background.filename))).toBe(true);
    expect(fs.existsSync(path.join(layeredIconRoot, foreground.filename))).toBe(true);
    expect(readPngMeta(path.join(layeredIconRoot, 'Assets', 'Background.png'))).toMatchObject({ width: 1024, height: 1024 });
    expect(readPngMeta(path.join(layeredIconRoot, 'Assets', 'Background-Dark.png'))).toMatchObject({ width: 1024, height: 1024 });
    expect(readPngMeta(path.join(layeredIconRoot, 'Assets', 'Foreground.png'))).toMatchObject({ width: 1024, height: 1024 });
  });
});
