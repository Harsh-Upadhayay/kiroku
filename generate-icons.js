import fs from 'fs';
import path from 'path';

const publicDir = path.join(process.cwd(), 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const darkSvgPath  = path.join(publicDir, 'icon-dark.svg');
const lightSvgPath = path.join(publicDir, 'icon-light.svg');

const buildIco = (pngBuffers) => {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  pngBuffers.forEach((buf, i) => {
    const entry = 6 + i * 16;
    const size = buf.__iconSize || 32;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buf.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngBuffers]);
};

(async () => {
  if (!fs.existsSync(darkSvgPath) || !fs.existsSync(lightSvgPath)) {
    console.warn('[PWA Build] icon-dark.svg or icon-light.svg missing in public/.');
    return;
  }

  try {
    const sharp = (await import('sharp')).default;
    const darkBuf  = fs.readFileSync(darkSvgPath);
    const lightBuf = fs.readFileSync(lightSvgPath);

    // Generate dark PNGs
    await Promise.all([180, 192, 512].map(s =>
      sharp(darkBuf).resize(s, s, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
        .png().toFile(path.join(publicDir, `icon-dark-${s}.png`))
    ));
    await sharp(darkBuf).resize(180, 180, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
      .png().toFile(path.join(publicDir, 'apple-touch-icon-dark.png'));

    // Generate light PNGs
    await Promise.all([180, 192, 512].map(s =>
      sharp(lightBuf).resize(s, s, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
        .png().toFile(path.join(publicDir, `icon-light-${s}.png`))
    ));
    await sharp(lightBuf).resize(180, 180, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
      .png().toFile(path.join(publicDir, 'apple-touch-icon-light.png'));

    // Legacy fallbacks (dark) — keeps older manifest entries working
    await Promise.all([180, 192, 512].map(s =>
      sharp(darkBuf).resize(s, s, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
        .png().toFile(path.join(publicDir, `icon-${s}.png`))
    ));
    await sharp(darkBuf).resize(180, 180, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } })
      .png().toFile(path.join(publicDir, 'apple-touch-icon.png'));

    // favicon.ico: dark icon at small sizes
    const faviconPngs = await Promise.all([16, 32, 48].map(async (size) => {
      const buf = await sharp(darkBuf).resize(size, size, { fit: 'contain', background: { r:0,g:0,b:0,alpha:0 } }).png().toBuffer();
      buf.__iconSize = size;
      return buf;
    }));
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buildIco(faviconPngs));

    console.log('[PWA Build] Dark + light icon PNGs generated from icon-dark.svg and icon-light.svg');
  } catch (err) {
    console.warn('[PWA Build] sharp failed:', err.message || err);
  }
})();
