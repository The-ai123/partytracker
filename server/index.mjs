import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { createStore, AppError } from './store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.PARTYTRACKER_DATA || resolve(root, 'data'));
await mkdir(dataDir, { recursive: true });
const store = createStore(resolve(dataDir, 'partytracker.sqlite'));
const port = Number(process.env.PORT || 4310);
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = async req => { let text = ''; for await (const chunk of req) { text += chunk; if (text.length > (req.url.startsWith('/api/setup/') ? 5000000 : 100000)) throw new AppError('Request is too large.', 413); } try { return JSON.parse(text || '{}'); } catch { throw new AppError('Invalid JSON.'); } };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
    if (path.startsWith('/api/')) {
      if (req.method !== 'GET') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new AppError('Use this app’s own page to make changes.', 403);
        if (!String(req.headers['content-type']).startsWith('application/json')) throw new AppError('JSON required.', 415);
      }
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, store.state());
      if (req.method === 'GET' && path === '/api/setup/export') {
        const setup = store.exportSetup(url.searchParams.get('party'));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="pour-setup.json"', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(setup, null, 2));
      }
      if (req.method === 'GET' && path === '/api/network') return json(res, 200, { urls: Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${port}/leaderboard`) });
      if (req.method === 'GET' && path === '/api/export') {
        const state = store.state(); const rows = [['Serving ID', 'Party', 'Guest', 'Drink', 'Quantity', 'Alcohol mL', 'USD', 'Status', 'Time', 'Ingredients']];
        for (const s of state.servings.filter(s => !url.searchParams.get('party') || s.party_id === url.searchParams.get('party'))) rows.push([s.id, state.parties.find(p => p.id === s.party_id)?.name, state.guests.find(g => g.id === s.guest_id)?.name, s.drink_name, s.quantity_label, s.alcohol_ml, (s.price_cents / 100).toFixed(2), s.status, s.created_at, JSON.stringify(s.ingredients)]);
        const csv = rows.map(row => row.map(value => { let t = String(value ?? ''); if (/^[=+@\-\t\r]/.test(t)) t = `'${t}`; return `"${t.replaceAll('"', '""')}"`; }).join(',')).join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="party-servings.csv"' }); return res.end('\uFEFF' + csv);
      }
      if (req.method === 'POST') {
        const b = await body(req); let result;
        if (path === '/api/parties') result = store.saveParty(b);
        else if (path === '/api/setup/preview' || path === '/api/setup/import') result = store.importSetup(b.setup, { create_party: b.create_party, party_name: b.party_name, preview: path.endsWith('/preview') });
        else if (path === '/api/guests') result = store.saveGuest(b);
        else if (path === '/api/drinks') result = store.saveDrink(b);
        else if (path === '/api/drinks/archive') result = store.archiveDrink(String(b.id), b.archived);
        else if (path === '/api/servings') result = store.submit(b);
        else if (path === '/api/servings/void') result = store.voidServing(String(b.id));
        else if (path === '/api/servings/delete') { if (b.confirm !== 'DELETE') throw new AppError('Deletion needs confirmation.'); result = store.deleteServing(String(b.id)); }
        else if (path === '/api/history') result = store.history(String(b.party_id), b.direction);
        else throw new AppError('Not found.', 404);
        return json(res, 200, result || { ok: true });
      }
      throw new AppError('Not found.', 404);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('Method not allowed.', 405);
    const file = resolve(root, 'dist', path === '/' ? 'index.html' : '.' + decodeURIComponent(path));
    if (!file.startsWith(resolve(root, 'dist') + '\\') && !file.startsWith(resolve(root, 'dist') + '/')) throw new AppError('Not found.', 404);
    let content, extension = extname(file);
    try { content = await readFile(file); } catch { if (extension) throw new AppError('File not found.', 404); content = await readFile(resolve(root, 'dist/index.html')); extension = '.html'; }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' })[extension] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(content);
  } catch (error) { if (!(error instanceof AppError)) console.error(error); json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong on the server.', ...error.details }); }
});
server.listen(port, '0.0.0.0', () => {
  console.log(`\nPour is ready: http://localhost:${port}\nDatabase: ${dataDir}\nKeep this window open while using the app.\n`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const opener = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process 'http://localhost:${port}'`], { windowsHide: true, stdio: 'ignore' });
    opener.on('error', () => console.log('Open the localhost link above in your browser.'));
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(); }));
