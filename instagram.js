// Loads a public Instagram profile without login by reading the post data that
// Instagram embeds in the public profile page (newest ~12 posts).
// The page is requested the way a browser opens it.
const BASE = process.env.IG_BASE || 'https://www.instagram.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

class IgError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const notFound = (u) =>
  new IgError(
    `Instagram did not show @${u}. If the account exists, Instagram may be blocking logged-out visits right now. Try again later, or import your Instagram data export.`,
    'not_found'
  );
const loginWall = () =>
  new IgError(
    'Instagram asked for a login instead of showing the profile. Try again in a while, or import your Instagram data export.',
    'login_required'
  );

const profileUrl = (u) => `${BASE}/${encodeURIComponent(u)}/`;

function extractJsonScripts(html) {
  const out = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// Web mode: request the page like a browser navigation (Instagram only embeds
// the data for page loads). Uses http(s).request because fetch() overrides the
// Sec-Fetch headers.
function getPage(url) {
  const lib = url.startsWith('https:') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchPageScripts(username) {
  let res;
  try {
    res = await getPage(profileUrl(username));
  } catch {
    throw new IgError('Could not reach Instagram. Check your internet connection.', 'offline');
  }
  if (res.status === 404) throw notFound(username);
  if (res.status >= 300 && res.status < 400) throw loginWall();
  if (res.status === 429) throw new IgError('Instagram is limiting requests right now. Wait a few minutes and try again.', 'rate_limited');
  if (res.status >= 400) throw new IgError(`Instagram returned an error (${res.status}).`, 'bad_status');
  return extractJsonScripts(res.body);
}

// ---------- parsing the embedded data ----------
function walk(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 60) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit, depth + 1);
    return;
  }
  visit(node);
  for (const k in node) walk(node[k], visit, depth + 1);
}

function bestImage(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return candidates.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url || null;
}

function mediaFrom(o) {
  // Current format (API v1 style objects)
  const first = Array.isArray(o.carousel_media) && o.carousel_media[0];
  const v1Image =
    bestImage(o.image_versions2 && o.image_versions2.candidates) ||
    bestImage(first && first.image_versions2 && first.image_versions2.candidates) ||
    o.display_uri || o.display_url || o.thumbnail_url || o.thumbnail_src ||
    (first && (first.display_uri || first.display_url)) || null;
  if (typeof o.code === 'string' && /^[\w-]{2,}$/.test(o.code) && v1Image) {
    return {
      id: String(o.pk || o.id || o.code).split('_')[0],
      shortcode: o.code,
      imageUrl: v1Image,
      isVideo: o.media_type === 2,
      isReel: o.product_type === 'clips',
      isCarousel: o.media_type === 8 || Array.isArray(o.carousel_media),
      pinned: (Array.isArray(o.timeline_pinned_user_ids) && o.timeline_pinned_user_ids.length > 0) ||
        (Array.isArray(o.pinned_for_users) && o.pinned_for_users.length > 0),
      takenAt: o.taken_at || o.taken_at_timestamp || 0,
      width: o.original_width || null,
      height: o.original_height || null,
      caption: (o.caption && o.caption.text) || '',
      owner: (o.user && o.user.username) || (o.owner && o.owner.username) || null,
    };
  }
  // Older GraphQL format
  if (typeof o.shortcode === 'string' && (o.display_url || o.display_uri || o.thumbnail_src)) {
    return {
      id: String(o.id || o.shortcode),
      shortcode: o.shortcode,
      imageUrl: o.display_url || o.display_uri || o.thumbnail_src,
      isVideo: !!o.is_video,
      isReel: o.product_type === 'clips',
      isCarousel: o.__typename === 'GraphSidecar' || !!o.edge_sidecar_to_children,
      pinned: Array.isArray(o.pinned_for_users) && o.pinned_for_users.length > 0,
      takenAt: o.taken_at_timestamp || 0,
      width: o.dimensions ? o.dimensions.width : null,
      height: o.dimensions ? o.dimensions.height : null,
      caption:
        (o.edge_media_to_caption && o.edge_media_to_caption.edges[0] && o.edge_media_to_caption.edges[0].node.text) || '',
      owner: (o.owner && o.owner.username) || null,
    };
  }
  return null;
}

function parsePage(scripts, username) {
  const u = username.toLowerCase();
  const posts = [];
  const seen = new Set();
  const profile = {};
  const take = (k, v) => {
    if (v != null && v !== '' && profile[k] == null) profile[k] = v;
  };
  for (const text of scripts) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    walk(json, (o) => {
      const m = mediaFrom(o);
      if (m) {
        if (m.owner && m.owner.toLowerCase() !== u) return;
        if (!m.imageUrl || seen.has(m.shortcode)) return;
        seen.add(m.shortcode);
        delete m.owner;
        posts.push(m);
        return;
      }
      if (typeof o.username === 'string' && o.username.toLowerCase() === u) {
        take('fullName', o.full_name);
        take('bio', o.biography);
        take('picUrl', (o.hd_profile_pic_url_info && o.hd_profile_pic_url_info.url) || o.profile_pic_url_hd || o.profile_pic_url);
        take('followers', o.follower_count != null ? o.follower_count : o.edge_followed_by && o.edge_followed_by.count);
        take('following', o.following_count != null ? o.following_count : o.edge_follow && o.edge_follow.count);
        take('postCount', o.media_count != null ? o.media_count : o.edge_owner_to_timeline_media && o.edge_owner_to_timeline_media.count);
        if (typeof o.is_private === 'boolean') take('isPrivate', o.is_private);
        profile.found = true;
      }
    });
  }
  return { posts, profile };
}

const lastPage = new Map(); // username -> what the last load saw (for the diagnostic report)

async function fetchProfile(username, { getScripts } = {}) {
  const got = await (getScripts || fetchPageScripts)(username);
  const page = Array.isArray(got) ? { scripts: got, mode: 'web' } : got;
  const scripts = page.scripts || [];
  const { posts, profile } = parsePage(scripts, username);
  // Posts read from a rendered page, if a page loader provides them.
  if (!posts.length && Array.isArray(page.domPosts)) {
    for (const d of page.domPosts) {
      if (!d.img || posts.some((p) => p.shortcode === d.shortcode)) continue;
      posts.push({ id: d.shortcode, shortcode: d.shortcode, imageUrl: d.img, isVideo: d.kind === 'reel', isReel: d.kind === 'reel',
        isCarousel: false, pinned: !!d.pinned, takenAt: 0, width: null, height: null, caption: d.alt || '' });
    }
  }
  lastPage.set(username, { ...page, parsedPosts: posts.length, profileFound: !!profile.found, at: new Date().toISOString() });
  if (!posts.length) {
    if (profile.isPrivate) throw new IgError(`@${username} is a private account. Only public accounts can be loaded without login.`, 'private');
    if (!profile.found) throw scripts.length ? notFound(username) : loginWall();
  }
  return {
    profile: {
      username,
      fullName: profile.fullName || '',
      bio: profile.bio || '',
      picUrl: profile.picUrl || '',
      followers: profile.followers != null ? profile.followers : null,
      following: profile.following != null ? profile.following : null,
      postCount: profile.postCount != null ? profile.postCount : posts.length || null,
      isPrivate: !!profile.isPrivate,
    },
    posts,
  };
}

// A report of the page's data *structure* (field names and counts, no values),
// so a missing format can be fixed without sharing personal data.
function diagnose(username) {
  const page = lastPage.get(username);
  if (!page) return 'No load recorded for @' + username + ' yet. Press Refresh first, then copy the report again.';
  const scripts = page.scripts || [];
  const all = scripts.join('\n');
  const count = (needle) => all.split(needle).length - 1;
  const interesting = /media|post|timeline|edge|node|code|image|display|thumb|xdt|clip|feed|carousel|candidate|items|grid|profile|user/i;
  const paths = new Map();
  for (const text of scripts) {
    let json;
    try { json = JSON.parse(text); } catch { continue; }
    (function rec(node, path, depth) {
      if (!node || typeof node !== 'object' || depth > 40) return;
      if (Array.isArray(node)) { for (const x of node.slice(0, 50)) rec(x, path + '[]', depth + 1); return; }
      for (const k of Object.keys(node)) {
        if (/^\d+$/.test(k)) continue;
        const p = (path ? path + '.' : '') + k;
        const short = p.split('.').slice(-6).join('.');
        if (interesting.test(k)) paths.set(short, (paths.get(short) || 0) + 1);
        rec(node[k], p, depth + 1);
      }
    })(json, '', 0);
  }
  const lines = [
    'GridLock diagnostic report',
    `mode: ${page.mode || 'web'} | time: ${page.at}`,
    `json scripts: ${scripts.length} | chars: ${all.length}`,
    `posts parsed: ${page.parsedPosts} | profile found: ${page.profileFound}`,
    `post links on rendered page: ${Array.isArray(page.domPosts) ? page.domPosts.length : 'n/a (web mode)'}`,
    'raw counts: ' + ['"code":"', '"shortcode":"', 'image_versions2', 'display_uri', 'display_url', 'thumbnail', 'xdt_api__v1__feed__user_timeline', 'timeline_media', 'carousel_media', '"media_type"', '/p/', 'login']
      .map((n) => `${n}=${count(n)}`).join(' '),
    '',
    'field paths (count):',
    ...[...paths].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 300).map(([p, c]) => `  ${p} (${c})`),
  ];
  return lines.join('\n');
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { diagnose, fetchProfile, downloadImage, extractJsonScripts, profileUrl, IgError, notFound, loginWall };
