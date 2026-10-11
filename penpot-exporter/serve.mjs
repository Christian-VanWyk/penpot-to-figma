// Serves this folder at http://localhost:4400 so Penpot can load the plugin.
// Usage:  node serve.mjs [port]
// Leave it running while you use the plugin; press Ctrl+C to stop.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 4400;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, 'localhost', () => {
  console.log('Penpot plugin is being served.');
  console.log(`In Penpot, open Plugins (Ctrl+Alt+P) and install: http://localhost:${port}/manifest.json`);
  console.log('Keep this running while you use it. Press Ctrl+C to stop.');
});
