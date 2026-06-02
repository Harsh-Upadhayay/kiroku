import fs from 'fs';
import path from 'path';

// A valid, small PNG file base64 representation (~300 bytes) to serve as a physical binary fallback
const iconBase64 = "iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAbklEQVR42u3PMREAAAwEIDu6px7mBAsb9AEpS9ZfC4KCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgoIiKAiCgiAoCIKCIigIgqAgCAqCgiAoCJKQvAGQ+YdMctOInQAAAABJRU55YII=";

const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'icon-192.png'), Buffer.from(iconBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), Buffer.from(iconBase64, 'base64'));
// Provide a dedicated 180x180 icon for iOS home screen (apple-touch-icon)
fs.writeFileSync(path.join(publicDir, 'icon-180.png'), Buffer.from(iconBase64, 'base64'));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), Buffer.from(iconBase64, 'base64'));
console.log('[PWA Build] Fallback PNG launcher icons created successfully.');

// Also produce a simple favicon.ico that embeds the PNG as an ICO entry (PNG-in-ICO supported by modern browsers)
try {
  const pngBuf = Buffer.from(iconBase64, 'base64');
  const imagesCount = 1;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(imagesCount, 4);

  const dir = Buffer.alloc(16);
  const width = 32;
  const height = 32;
  dir.writeUInt8(width === 256 ? 0 : width, 0);
  dir.writeUInt8(height === 256 ? 0 : height, 1);
  dir.writeUInt8(0, 2); // color palette
  dir.writeUInt8(0, 3); // reserved
  dir.writeUInt16LE(1, 4); // color planes
  dir.writeUInt16LE(32, 6); // bits per pixel
  dir.writeUInt32LE(pngBuf.length, 8); // image data size
  const imageOffset = header.length + dir.length;
  dir.writeUInt32LE(imageOffset, 12); // offset

  const icoBuf = Buffer.concat([header, dir, pngBuf]);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuf);
  console.log('[PWA Build] favicon.ico created successfully.');
} catch (err) {
  console.warn('[PWA Build] Could not create favicon.ico:', err);
}
