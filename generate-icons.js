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
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), Buffer.from(iconBase64, 'base64'));
  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), Buffer.from(iconBase64, 'base64'));
  fs.writeFileSync(path.join(publicDir, 'icon-180.png'), Buffer.from(iconBase64, 'base64'));
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), Buffer.from(iconBase64, 'base64'));
  console.log('[PWA Build] Fallback PNG launcher icons created successfully.');
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
