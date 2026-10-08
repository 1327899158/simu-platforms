const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const htmlPath = path.resolve(__dirname, '../../仿真通-宣传页.html');

const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(htmlPath));
  } catch {
    res.writeHead(500); res.end('Preview unavailable');
  }
});
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
