// Local server for GridLock. Serves the app, fetches Instagram, and keeps an
// offline copy of each feed (data + images) on disk.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchProfile, downloadImage, IgError } = require('./instagram');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};
const KEEP_OLD_POSTS = 60; // older posts kept from earlier fetches

function cleanUsername(raw) {
  const u = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : null;
}

function createServer(dataDir, { getScripts } = {}) {
  const feedsDir = path.join(dataDir, 'feeds');
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(feedsDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });

  const feedFile = (u) => path.join(feedsDir, `${u}.json`);
  const readCache = (u) => {
    try {
      return JSON.parse(fs.readFileSync(feedFile(u), 'utf8'));
    } catch {
      return null;
    }
  };

  async function cacheImage(u, name, url) {
    const dir = path.join(mediaDir, u);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.jpg`);
    if (!fs.existsSync(file) && url) {
      try {
        fs.writeFileSync(file, await downloadImage(url));
      } catch {
        return null;
      }
    }
    return `/media/${u}/${name}.jpg`;
  }

  async function fetchLive(u) {
    const live = await fetchProfile(u, { getScripts });
    if (live.profile.isPrivate && live.posts.length === 0) {
      throw new IgError(`@${u} is a private account. Only public accounts can be loaded without login.`, 'private');
    }
    const posts = [];
    // download a few at a time
    for (let i = 0; i < live.posts.length; i += 4) {
      const batch = live.posts.slice(i, i + 4);
      const images = await Promise.all(batch.map((p) => cacheImage(u, p.id, p.imageUrl)));
      batch.forEach((p, j) => {
        const { imageUrl, ...rest } = p;
        posts.push({ ...rest, image: images[j] });
      });
    }
    // Without login Instagram only returns the latest ~12. Keep older posts we saw
    // before, but only ones older than everything in this fetch (newer missing
    // ones were deleted on Instagram).
    const prev = readCache(u);
    const unpinned = posts.filter((p) => !p.pinned);
    const oldest = unpinned.length ? Math.min(...unpinned.map((p) => p.takenAt)) : 0;
    if (prev && oldest) {
      const have = new Set(posts.map((p) => p.id));
      const older = prev.posts
        .filter((p) => !have.has(p.id) && !p.pinned && p.takenAt < oldest)
        .slice(0, KEEP_OLD_POSTS);
      posts.push(...older);
    }
    const avatar = await cacheImage(u, '_avatar', live.profile.picUrl);
    const { picUrl, ...profile } = live.profile;
    const feed = { username: u, profile: { ...profile, avatar }, posts, fetchedAt: new Date().toISOString() };
    fs.writeFileSync(feedFile(u), JSON.stringify(feed, null, 2));
    return feed;
  }

  function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  function serveFile(res, file) {
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/feed') {
        const u = cleanUsername(url.searchParams.get('username'));
        if (!u) return send(res, 400, { error: 'Enter a valid Instagram username.' });
        const preferCache = url.searchParams.get('cache') === '1';
        const cached = readCache(u);
        if (preferCache && cached) return send(res, 200, { ...cached, source: 'cache' });
        try {
          const feed = await fetchLive(u);
          return send(res, 200, { ...feed, source: 'live' });
        } catch (e) {
          const msg = e instanceof IgError ? e.message : 'Something went wrong while loading from Instagram.';
          if (cached && e.code !== 'private') {
            return send(res, 200, { ...cached, source: 'cache', warning: msg });
          }
          return send(res, 502, { error: msg, code: e.code || 'unknown' });
        }
      }
      if (url.pathname === '/api/saved') {
        const names = fs.readdirSync(feedsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
        return send(res, 200, { usernames: names });
      }
      if (url.pathname.startsWith('/media/')) {
        const rel = path.normalize(decodeURIComponent(url.pathname.slice(7)));
        const file = path.join(mediaDir, rel);
        if (!file.startsWith(mediaDir + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
        return serveFile(res, file);
      }
      const rel = url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname.slice(1)));
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
      return serveFile(res, file);
    } catch (e) {
      send(res, 500, { error: 'Server error' });
    }
  });
}

function start({ port, dataDir, host = '127.0.0.1', getScripts }) {
  return new Promise((resolve, reject) => {
    const server = createServer(dataDir, { getScripts });
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.env.PORT) || 5178;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  start({ port, dataDir })
    .then(() => {
      const url = `http://localhost:${port}`;
      console.log(`GridLock is running at ${url}`);
      console.log('Keep this window open while you use the app. Press Ctrl+C to stop.');
      if (process.argv.includes('--open')) {
        const { exec } = require('child_process');
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd, () => {});
      }
    })
    .catch((e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`Port ${port} is already in use. GridLock may already be running: open http://localhost:${port}`);
      } else console.error(e);
      process.exit(1);
    });
}
