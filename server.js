'use strict';
/**
 * TwoSeats server
 *  - serves the web app (public/)
 *  - /api/ice   -> STUN/TURN servers for WebRTC (TURN optional, via env vars)
 *  - /ws        -> signaling for 2-person rooms (only SDP/ICE pass through here;
 *                  the movie, voice and camera go peer-to-peer)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- TURN config (all optional) -------------------------------------------
// Option A (recommended, 1000 GB/month free): Cloudflare Realtime TURN
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID || '';
const CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN || '';
// Option B: any TURN provider with static credentials (Metered, coturn, ...)
const TURN_URLS = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';

const STUN = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
let cfCache = { servers: null, expires: 0 };

async function getIceServers() {
  const servers = [STUN];
  if (CF_TURN_KEY_ID && CF_TURN_API_TOKEN) {
    try {
      if (!cfCache.servers || Date.now() > cfCache.expires) {
        const ttl = 24 * 3600;
        const r = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CF_TURN_KEY_ID)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl }),
          }
        );
        if (!r.ok) throw new Error(`Cloudflare TURN HTTP ${r.status}`);
        const j = await r.json();
        let list = Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
        // Browsers block port 53; those URLs only time out, so drop them.
        list = list
          .filter(Boolean)
          .map((s) => {
            const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
            return { ...s, urls };
          })
          .filter((s) => s.urls.length);
        cfCache = { servers: list, expires: Date.now() + (ttl / 2) * 1000 };
      }
      return servers.concat(cfCache.servers);
    } catch (err) {
      console.error('[ice] Cloudflare TURN failed:', err.message);
    }
  }
  if (TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  return servers;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let p = pathname;
  if (p === '/' || p.startsWith('/r/')) p = '/index.html'; // room links: /r/<code>
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const lastMod = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === lastMod) return send(res, 304, '');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': lastMod,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (pathname === '/api/ice') {
    const iceServers = await getIceServers();
    return send(res, 200, JSON.stringify({ iceServers }), {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, pathname);
});

// ---- Signaling --------------------------------------------------------------
/** rooms: Map<roomId, Map<clientId, ws>> */
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

const ROOM_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function out(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function otherIn(room, ws) {
  for (const [, peer] of room) if (peer !== ws) return peer;
  return null;
}

function leave(ws) {
  const roomId = ws.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  ws.roomId = null;
  if (!room || room.get(ws.clientId) !== ws) return;
  room.delete(ws.clientId);
  const other = otherIn(room, ws);
  if (other) out(other, { type: 'peer-left', peerId: ws.clientId });
  if (room.size === 0) rooms.delete(roomId);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    ws.isAlive = true;

    switch (msg.type) {
      case 'ping':
        return out(ws, { type: 'pong' });

      case 'join': {
        const roomId = String(msg.room || '').toLowerCase();
        const clientId = String(msg.clientId || '');
        if (!ROOM_RE.test(roomId) || !ID_RE.test(clientId)) {
          return out(ws, { type: 'error', code: 'bad-request', message: 'Invalid room code.' });
        }
        leave(ws);
        let room = rooms.get(roomId);
        if (!room) rooms.set(roomId, (room = new Map()));

        // Same browser tab reconnecting (e.g. after a network blip): replace the old socket.
        const stale = room.get(clientId);
        if (stale && stale !== ws) {
          stale.roomId = null;
          room.delete(clientId);
          try { stale.close(4000, 'replaced'); } catch {}
        }
        if (room.size >= 2) return out(ws, { type: 'full' });

        ws.roomId = roomId;
        ws.clientId = clientId;
        ws.name = String(msg.name || '').slice(0, 24);
        room.set(clientId, ws);
        out(ws, { type: 'joined', count: room.size });

        if (room.size === 2) {
          const pairId = crypto.randomBytes(6).toString('hex');
          const [a, b] = [...room.values()];
          out(a, { type: 'ready', peerId: b.clientId, peerName: b.name, pairId });
          out(b, { type: 'ready', peerId: a.clientId, peerName: a.name, pairId });
        }
        return;
      }

      case 'signal': {
        const room = ws.roomId && rooms.get(ws.roomId);
        if (!room) return;
        const other = otherIn(room, ws);
        if (other) out(other, { type: 'signal', data: msg.data });
        return;
      }

      case 'leave':
        return leave(ws);
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// Drop dead sockets so a stuck tab can't hold a seat forever.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  const turn = CF_TURN_KEY_ID ? 'Cloudflare' : TURN_URLS.length ? 'static' : 'none (STUN only)';
  console.log(`TwoSeats on http://localhost:${PORT}  |  TURN: ${turn}`);
});
