import fs from 'fs';
import path from 'path';

const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const svgPath = path.join(publicDir, 'icon.svg');

// Helper to write a raw PNG fallback if SVG rasterization isn't available
const writeFallbackPNGs = () => {
  const iconBase64 = "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAbklEQVR42u3PMREAAAwEIDu6px7mBAsb9AEpS9ZfC4KCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgqAgCAqCgiAoCJKQvAGQ+YdMctOInQAAAABJRU55YII=";
  const fallback = Buffer.from(iconBase64, 'base64');
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), fallback);
  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), fallback);
  fs.writeFileSync(path.join(publicDir, 'icon-180.png'), fallback);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), fallback);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buildIco([fallback]));
  console.log('[PWA Build] Fallback PNG launcher icons created successfully.');
};

// Wrap one or more same-format PNG buffers into a minimal ICO container.
// Modern Windows/browsers support PNG-encoded image data inside ICO entries,
// so no separate BMP encoding step is needed.
const buildIco = (pngBuffers) => {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = header.length;
  pngBuffers.forEach((buf, i) => {
    const entry = 6 + i * 16;
    const size = buf.__iconSize || 32;
    header.writeUInt8(size >= 256 ? 0 : size, entry); // width
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // color count
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // planes
    header.writeUInt16LE(32, entry + 6); // bit count
    header.writeUInt32LE(buf.length, entry + 8); // bytes in resource
    header.writeUInt32LE(offset, entry + 12); // image data offset
    offset += buf.length;
  });

  return Buffer.concat([header, ...pngBuffers]);
};

(async () => {
  if (fs.existsSync(svgPath)) {
    try {
      const sharp = await import('sharp');
      const svgBuffer = fs.readFileSync(svgPath);
      const sizes = [180, 192, 512];
      await Promise.all(
        sizes.map(async (s) => {
          const out = path.join(publicDir, `icon-${s}.png`);
          await sharp.default(svgBuffer).resize(s, s, { fit: 'contain' }).png().toFile(out);
        })
      );
      // also create apple-touch-icon.png as 180x180
      await sharp.default(svgBuffer).resize(180, 180, { fit: 'contain' }).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));

      // favicon.ico: multi-resolution, rasterized fresh from icon.svg each
      // build so it can't drift from the current logo (it used to be a
      // one-off copy of an old icon-192.png that never got regenerated).
      const faviconSizes = [16, 32, 48];
      const faviconPngs = await Promise.all(
        faviconSizes.map(async (size) => {
          const buf = await sharp.default(svgBuffer).resize(size, size, { fit: 'contain' }).png().toBuffer();
          buf.__iconSize = size;
          return buf;
        })
      );
      fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buildIco(faviconPngs));

      console.log('[PWA Build] Rasterized PNG launcher icons from icon.svg');
    } catch (err) {
      console.warn('[PWA Build] sharp not available or rasterization failed, falling back to embedded PNGs. Error:', err.message || err);
      writeFallbackPNGs();
    }
  } else {
    console.warn('[PWA Build] icon.svg not found in public/. Writing fallback PNGs.');
    writeFallbackPNGs();
  }
})();
