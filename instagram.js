// Fetches a public Instagram profile without login.
// Instagram limits this to the ~12 most recent posts and may rate-limit.
const API_BASES = process.env.IG_API_BASE
  ? [process.env.IG_API_BASE]
  : ['https://i.instagram.com', 'https://www.instagram.com'];

const HEADERS = {
  'x-ig-app-id': '936619743392459',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
};

class IgError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function fetchProfile(username) {
  let lastErr;
  for (const base of API_BASES) {
    const url = `${base}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    let res;
    try {
      res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      lastErr = new IgError('Could not reach Instagram. Check your internet connection.', 'offline');
      continue;
    }
    if (res.status === 404) throw new IgError(`Account @${username} was not found.`, 'not_found');
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      lastErr = new IgError('Instagram is limiting requests right now. Wait a few minutes and try again.', 'rate_limited');
      continue;
    }
    if (!res.ok) {
      lastErr = new IgError(`Instagram returned an error (${res.status}).`, 'bad_status');
      continue;
    }
    let json;
    try {
      json = await res.json();
    } catch {
      lastErr = new IgError('Instagram sent an unexpected response (it may be asking for login).', 'bad_response');
      continue;
    }
    const user = json && json.data && json.data.user;
    if (!user) throw new IgError(`Account @${username} was not found.`, 'not_found');
    return parseUser(user);
  }
  throw lastErr;
}

function parseUser(user) {
  const media = user.edge_owner_to_timeline_media || {};
  const posts = (media.edges || []).map(({ node }) => ({
    id: String(node.id),
    shortcode: node.shortcode,
    imageUrl: node.display_url || node.thumbnail_src,
    isVideo: !!node.is_video,
    isReel: node.product_type === 'clips',
    isCarousel: node.__typename === 'GraphSidecar' || !!node.edge_sidecar_to_children,
    pinned: Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0,
    takenAt: node.taken_at_timestamp || 0,
    width: node.dimensions ? node.dimensions.width : null,
    height: node.dimensions ? node.dimensions.height : null,
    caption:
      (node.edge_media_to_caption &&
        node.edge_media_to_caption.edges[0] &&
        node.edge_media_to_caption.edges[0].node.text) ||
      '',
  }));
  return {
    profile: {
      username: user.username,
      fullName: user.full_name || '',
      bio: user.biography || '',
      picUrl: user.profile_pic_url_hd || user.profile_pic_url || '',
      followers: user.edge_followed_by ? user.edge_followed_by.count : null,
      following: user.edge_follow ? user.edge_follow.count : null,
      postCount: media.count != null ? media.count : posts.length,
      isPrivate: !!user.is_private,
    },
    posts,
  };
}

async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'user-agent': HEADERS['user-agent'] }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { fetchProfile, downloadImage, IgError };
