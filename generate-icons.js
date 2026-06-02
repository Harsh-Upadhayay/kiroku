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
console.log('[PWA Build] Fallback PNG launcher icons created successfully.');
