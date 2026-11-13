// GridLock front end.
// Plan = ordered list of keys: "ig:<postId>" (live post) or "local:<uuid>" (planned photo).
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // ---------- IndexedDB for planned photos ----------
  const dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open('feed-planner', 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore('photos', { keyPath: 'id' });
      s.createIndex('username', 'username');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function tx(mode, fn) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const t = db.transaction('photos', mode);
      const out = fn(t.objectStore('photos'));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }
  const putPhoto = (p) => tx('readwrite', (s) => s.put(p));
  const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id));
  const photosFor = (u) => tx('readonly', (s) => s.index('username').getAll(u));

  // ---------- state ----------
  let username = null;
  let feed = null;            // from server
  let order = [];             // plan keys
  let knownIg = [];           // live ids seen at last sync
  const locals = new Map();   // uuid -> {record, url}
  let ratio = LS.get('ifp:ratio', '45');

  const planKey = (u) => `ifp:plan:${u}`;
  const savePlan = () => username && LS.set(planKey(username), { order, knownIg });

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }
  function status(msg, isError) {
    const s = $('status');
    s.hidden = !msg; s.textContent = msg || '';
    s.classList.toggle('error', !!isError);
  }
  function busy(on) {
    document.body.classList.toggle('loading', on);
    $('loadBtn').disabled = on; $('refreshBtn').disabled = on;
  }
  const fmt = (n) => n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : n.toLocaleString();

  function setRatio(r) {
    ratio = r; LS.set('ifp:ratio', r);
    grid.classList.toggle('r45', r === '45');
    grid.classList.toggle('r11', r === '11');
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === r));
  }

  // ---------- render ----------
  function render() {
    const posts = new Map((feed ? feed.posts : []).map((p) => [p.id, p]));
    order = order.filter((k) => (k.startsWith('ig:') ? posts.has(k.slice(3)) : locals.has(k.slice(6))));
    grid.innerHTML = '';
    for (const key of order) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.draggable = true;
      tile.dataset.key = key;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.draggable = false;
      const dot = document.createElement('i');
      if (key.startsWith('ig:')) {
        const p = posts.get(key.slice(3));
        img.src = p.image || '';
        img.alt = p.caption ? p.caption.slice(0, 80) : 'Instagram post';
        dot.className = 'dot live';
        tile.title = 'On Instagram' + (p.pinned ? ' (pinned)' : '');
        const badge = p.pinned ? '📌' : p.isReel || p.isVideo ? '▶' : p.isCarousel ? '❐' : '';
        if (badge) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = badge; tile.append(b); }
      } else {
        const l = locals.get(key.slice(6));
        img.src = l.url; img.alt = l.record.name || 'Planned photo';
        dot.className = 'dot planned';
        tile.title = 'Planned: ' + (l.record.name || '');
        const rm = document.createElement('button');
        rm.className = 'remove'; rm.type = 'button'; rm.textContent = '×'; rm.title = 'Remove from plan';
        rm.addEventListener('click', (e) => { e.stopPropagation(); removeLocal(key.slice(6)); });
        tile.append(rm);
      }
      tile.prepend(img, dot);
      grid.append(tile);
    }
    const loaded = !!feed;
    $('empty').hidden = loaded;
    $('toolbar').hidden = $('legend').hidden = !loaded;
    $('profile').hidden = !loaded;
    if (loaded) {
      const pr = feed.profile || {};
      $('avatar').src = pr.avatar || '';
      $('pname').textContent = '@' + feed.username + (pr.fullName ? ' · ' + pr.fullName : '');
      const planned = order.filter((k) => k.startsWith('local:')).length;
      $('pstats').textContent = [
        pr.postCount != null ? `${fmt(pr.postCount)} posts` : '',
        pr.followers != null ? `${fmt(pr.followers)} followers` : '',
        planned ? `${planned} planned` : '',
      ].filter(Boolean).join(' · ');
    }
  }

  // ---------- sync plan with feed ----------
  function reconcile() {
    const liveIds = feed.posts.map((p) => p.id);
    const saved = LS.get(planKey(username), null);
    if (!saved) {
      order = liveIds.map((id) => 'ig:' + id);
      knownIg = liveIds;
      return 0;
    }
    order = saved.order; knownIg = saved.knownIg || [];
    const known = new Set(knownIg);
    const inOrder = new Set(order);
    const fresh = liveIds.filter((id) => !known.has(id) && !inOrder.has('ig:' + id));
    if (fresh.length) {
      // New Instagram posts go where the live feed starts (below planned photos at the top).
      // Posts that are older than what we know (fetched from history) go at the end.
      const firstIg = order.findIndex((k) => k.startsWith('ig:'));
      const knownTimes = feed.posts.filter((p) => known.has(p.id)).map((p) => p.takenAt);
      const newest = knownTimes.length ? Math.max(...knownTimes) : Infinity;
      const top = [], bottom = [];
      for (const id of fresh) {
        const p = feed.posts.find((x) => x.id === id);
        (p.takenAt >= newest || p.pinned ? top : bottom).push('ig:' + id);
      }
      const at = firstIg === -1 ? order.length : firstIg;
      order = [...order.slice(0, at), ...top, ...order.slice(at), ...bottom];
    }
    knownIg = liveIds;
    return fresh.length;
  }

  async function loadLocals(u) {
    for (const l of locals.values()) URL.revokeObjectURL(l.url);
    locals.clear();
    const recs = await photosFor(u).catch(() => []);
    for (const r of recs) locals.set(r.id, { record: r, url: URL.createObjectURL(r.blob) });
    // Planned photos missing from the order (should not happen) go on top.
    for (const id of locals.keys()) if (!order.includes('local:' + id)) order.unshift('local:' + id);
  }

  async function load(u, { preferCache = false, isRefresh = false } = {}) {
    u = String(u || '').trim().replace(/^@/, '').toLowerCase();
    if (!u) return;
    busy(true); status('');
    try {
      const res = await fetch(`/api/feed?username=${encodeURIComponent(u)}${preferCache ? '&cache=1' : ''}`);
      const data = await res.json();
      if (!res.ok) { status(data.error || 'Could not load this account.', true); return; }
      const switched = u !== username;
      username = u; feed = data;
      LS.set('ifp:last', u);
      $('username').value = u;
      const added = reconcile();
      await loadLocals(u);
      savePlan();
      render();
      if (data.source === 'cache') {
        const when = new Date(data.fetchedAt).toLocaleString();
        status((data.warning ? data.warning + ' ' : '') + `Showing the saved copy from ${when}.`);
      }
      if (isRefresh && data.source === 'live') toast(added ? `${added} new post${added > 1 ? 's' : ''} added from Instagram` : 'Up to date with Instagram');
      else if (switched && data.source === 'live') toast(`Loaded @${u}`);
    } catch (e) {
      status('Could not reach the GridLock server. Make sure it is still running.', true);
    } finally {
      busy(false);
    }
  }

  // ---------- planned photos ----------
  async function shrink(file) {
    // Keep planned photos light: max 1440px on the long side.
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1440 / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 2.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', 0.9));
    } catch {
      return null; // not decodable (e.g. HEIC in some browsers)
    }
  }

  async function addFiles(files, atKey) {
    if (!username) { toast('Load an account first'); return; }
    const imgs = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(f.name));
    if (!imgs.length) { toast('Those files are not images'); return; }
    const keys = []; let failed = 0;
    for (const f of imgs) {
      const blob = await shrink(f);
      if (!blob) { failed++; continue; }
      const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
      const record = { id, username, blob, name: f.name, addedAt: Date.now() };
      await putPhoto(record);
      locals.set(id, { record, url: URL.createObjectURL(blob) });
      keys.push('local:' + id);
    }
    let at = atKey ? order.indexOf(atKey) : 0;
    if (at < 0) at = 0;
    order.splice(at, 0, ...keys);
    savePlan(); render();
    if (keys.length) toast(`Added ${keys.length} photo${keys.length > 1 ? 's' : ''}`);
    if (failed) status(`${failed} file${failed > 1 ? 's' : ''} could not be read. Try JPG or PNG (HEIC is not supported everywhere).`, true);
  }

  async function removeLocal(id) {
    const l = locals.get(id);
    if (l) URL.revokeObjectURL(l.url);
    locals.delete(id);
    order = order.filter((k) => k !== 'local:' + id);
    await deletePhoto(id).catch(() => {});
    savePlan(); render();
  }

  async function reset() {
    if (!feed) return;
    const planned = locals.size;
    const msg = planned
      ? `Reset to the original Instagram feed?\n\nThis removes your ${planned} planned photo${planned > 1 ? 's' : ''} and undoes all moves.`
      : 'Reset to the original Instagram order?';
    if (!confirm(msg)) return;
    for (const id of [...locals.keys()]) await deletePhoto(id).catch(() => {});
    for (const l of locals.values()) URL.revokeObjectURL(l.url);
    locals.clear();
    order = feed.posts.map((p) => 'ig:' + p.id);
    knownIg = feed.posts.map((p) => p.id);
    savePlan(); render();
    toast('Back to the original feed');
  }

  // ---------- drag to reorder (moves DOM live, saves on drop) ----------
  let dragEl = null;
  grid.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    dragEl = t;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-ifp', t.dataset.key);
    requestAnimationFrame(() => t.classList.add('dragging'));
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const t = e.target.closest('.tile');
    if (!t || t === dragEl) return;
    const tiles = [...grid.children];
    const from = tiles.indexOf(dragEl), to = tiles.indexOf(t);
    grid.insertBefore(dragEl, from < to ? t.nextSibling : t);
  });
  grid.addEventListener('drop', (e) => { if (dragEl) e.preventDefault(); });
  grid.addEventListener('dragend', () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    hideOverlay();
    order = [...grid.children].map((t) => t.dataset.key);
    savePlan();
  });

  // ---------- drop files from the computer ----------
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let overlayTimer;
  const hideOverlay = () => {
    $('dropOverlay').hidden = true;
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  };
  window.addEventListener('dragover', (e) => {
    if (dragEl || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    $('dropOverlay').hidden = false;
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(hideOverlay, 200); // hides once the drag leaves the window
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    const t = e.target.closest && e.target.closest('.tile');
    if (t) t.classList.add('drop-target');
  });
  window.addEventListener('drop', (e) => {
    if (dragEl || !hasFiles(e)) return;
    e.preventDefault();
    const t = e.target.closest && e.target.closest('.tile');
    clearTimeout(overlayTimer); hideOverlay();
    addFiles(e.dataTransfer.files, t ? t.dataset.key : null);
  });

  // ---------- wire up ----------
  $('userForm').addEventListener('submit', (e) => { e.preventDefault(); load($('username').value); });
  $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('refreshBtn').addEventListener('click', () => username && load(username, { isRefresh: true }));
  $('resetBtn').addEventListener('click', reset);
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setRatio(b.dataset.ratio)));

  setRatio(ratio);
  const last = LS.get('ifp:last', null);
  if (last) load(last, { preferCache: true }); // opens instantly, works offline
  else render();
})();
