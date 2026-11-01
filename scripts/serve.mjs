import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.argv[2] ?? process.env.WIREBENCH_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Use a port between 1 and 65535: npm start -- 5173');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let path;
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const fromRoot = relative(root, path);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || fromRoot.includes('\0')) {
      response.writeHead(403).end();
      return;
    }
  } catch {
    response.writeHead(400).end();
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const status = error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : status === 404 ? 'Not found' : 'Unable to read file');
  }
});

server.on('error', error => {
  console.error(`Unable to start Wirebench: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Wirebench: http://127.0.0.1:${port}`);
  console.log(`Full RIO schedule: http://127.0.0.1:${port}/?project=rio-schedule`);
  console.log('Press Ctrl+C to stop.');
});
