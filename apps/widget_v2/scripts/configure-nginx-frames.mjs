import { readFileSync, writeFileSync } from 'node:fs';
const origins = (process.env.WIDGET_FRAME_ANCESTORS ?? '').split(',').map(v => v.trim()).filter(Boolean);
if (origins.length === 0) throw new Error('WIDGET_FRAME_ANCESTORS must list the exact HTTPS frontend origins');
for (const origin of origins) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || /[\s;*'"$]/.test(origin)) throw new Error('Invalid widget frame ancestor origin');
}
const source = readFileSync('nginx.conf', 'utf8');
writeFileSync('nginx.generated.conf', source.replace(/frame-ancestors [^;]+;/, "frame-ancestors 'self' " + [...new Set(origins)].join(' ') + ';'));
