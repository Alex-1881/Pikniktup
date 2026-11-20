/* Pikniktüp v1.7.2 — server-side YouTube/Invidious discovery gateway.
 * Preserves the v1.6 frontend contract: /api/youtube?category=&search=&pageToken=&id=.
 * Search defaults to Invidious; the official YouTube API is used for trending / details.
 * No API key is ever returned to the browser or forwarded to Invidious.
 * Public Invidious instances can be unreliable; self-hosting is recommended for production.
 */
'use strict';

const VERSION = '1.7.2';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3/';
const OFFICIAL_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com'
];
// The hosts above are from the Invidious maintainers' official instance list.
// Availability must be checked at deployment time; it is not guaranteed.
const CATEGORIES = Object.freeze({
  'Müzik': '10', 'Şarkılar': '10', 'Oyun': '20', 'Komedi': '23',
  'Eğlence': '24', 'Film/Dizi': '1', 'Spor': '17',
  'Eğitim': '27', 'Teknoloji': '28', 'Yaşam': '22', 'Haber': '25'
});
const SPECIAL = new Set(['Klipler', 'Canlı', 'Shorts']);
const SEARCH_TERMS = Object.freeze({
  'Film/Dizi': 'dizi resmi kanal fragman',
  'Klipler': 'resmi müzik klipleri official music video',
  'Canlı': 'canlı müzik performansı live concert',
  'Shorts': '#shorts Türkiye',
  'Müzik': 'müzik Türkiye', 'Şarkılar': 'yeni şarkılar Türkiye',
  'Oyun': 'oyun Türkiye', 'Komedi': 'komedi Türkiye',
  'Eğlence': 'eğlence Türkiye', 'Spor': 'spor Türkiye',
  'Eğitim': 'eğitim Türkiye', 'Teknoloji': 'teknoloji Türkiye',
  'Yaşam': 'vlog Türkiye', 'Haber': 'haber Türkiye'
});
const ID_OK = /^[A-Za-z0-9_-]{11}$/;
const YT_TOKEN_OK = /^[A-Za-z0-9_-]{1,180}$/;
const INV_TOKEN_OK = /^iv_([1-9][0-9]{0,2})$/;
const YT_PREFIX_TOKEN_OK = /^yt_([A-Za-z0-9_-]{1,180})$/;
const STATIC_AUDIO = /(official\s*audio|audio\s*only|lyric(?:s)?\s*video|sözleri|visuali[sz]er|\btopic\b|full\s*album|albümün\s*tamamı)/i;
const CACHE_MAX = 180;
const cache = new Map();
const inflight = new Map();
const hostCooldown = new Map();
let officialSearchBlockedUntil = 0;

const cut = (v, length=200) => String(v ?? '').slice(0, length);
const finite = n => Math.max(0, Math.min(1e12, Number.isFinite(Number(n)) ? Number(n) : 0));
const isId = id => typeof id === 'string' && ID_OK.test(id);

function timestamp(value) {
  if (typeof value === 'string' && value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : '';
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 1100000000 || seconds > 4400000000) return '';
  return new Date(seconds * 1000).toISOString();
}
function duration(s) {
  const m = /^P(?:([0-9]+)D)?T?(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?$/.exec(String(s || ''));
  return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0) : 0;
}
function shape(id, metadata={}) {
  const secs = finite(metadata.duration);
  return {
    id: `youtube:${id}`, youtube: true, demo: true, owner_id: 'youtube', youtube_id: id,
    title: cut(metadata.title || 'YouTube videosu', 210),
    description: cut(metadata.description, 2500),
    author: cut(metadata.author || 'YouTube kanalı', 150),
    channel_id: cut(metadata.channelId, 150),
    category: 'YouTube', is_short: secs > 0 && secs <= 180, duration_seconds: secs,
    views: finite(metadata.views), likes_count: finite(metadata.likes),
    comments_count: finite(metadata.comments), created_at: timestamp(metadata.published),
    thumb_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    source_page: `https://www.youtube.com/watch?v=${id}`
  };
}
function fromInvidious(item) {
  if (!item || (item.type && item.type !== 'video') || !isId(item.videoId)) return null;
  return shape(item.videoId, {
    title: item.title, author: item.author, channelId: item.authorId,
    description: item.description, duration: item.lengthSeconds,
    views: item.viewCount, likes: item.likeCount, comments: item.commentCount,
    published: item.published
  });
}
function fromYouTube(item) {
  if (!item || !isId(item.id) || item.status?.privacyStatus !== 'public' || item.status?.embeddable !== true) return null;
  const s = item.snippet || {};
  return shape(item.id, {
    title: s.title, description: s.description, author: s.channelTitle,
    channelId: s.channelId, duration: duration(item.contentDetails?.duration),
    views: item.statistics?.viewCount, likes: item.statistics?.likeCount,
    comments: item.statistics?.commentCount, published: s.publishedAt
  });
}
function normalizeResults(items, category) {
  const ids = new Set();
  return (Array.isArray(items) ? items : []).map(item => item).filter(v => {
    if (!v || ids.has(v.youtube_id)) return false;
    if (category === 'Klipler' && STATIC_AUDIO.test(v.title + ' ' + v.author)) return false;
    if (category === 'Shorts' && !(v.duration_seconds > 0 && v.duration_seconds <= 180)) return false;
    if (category === 'Karışık' && STATIC_AUDIO.test(v.title + ' ' + v.author)) return false;
    ids.add(v.youtube_id);
    return true;
  });
}
function apiError(message, code, status=503, wait=0) {
  const error = new Error(message);
  error.code = code; error.status = status; error.wait = wait;
  return error;
}
async function fetchJson(url, ms=6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal, redirect: 'error',
      headers: { 'Accept': 'application/json', 'User-Agent': 'Pikniktup/1.7' }
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = cut(json?.error?.errors?.[0]?.reason || json?.error?.message || (typeof json?.error === 'string' ? json.error : ''), 90);
      const waitHeader = Number(response.headers.get('retry-after'));
      const wait = response.status === 429 ? Math.max(60, Math.min(600, Number.isFinite(waitHeader) && waitHeader > 0 ? waitHeader : 120)) : 0;
      throw apiError(reason || `HTTP ${response.status}`, response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR', response.status, wait);
    }
    if (json === null || typeof json !== 'object') throw apiError('Geçersiz API cevabı', 'INVALID_RESPONSE', 502);
    return json;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw apiError('API yanıt vermedi (zaman aşımı)', 'UPSTREAM_TIMEOUT', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
async function ytFetch(endpoint, params, key) {
  const url = new URL(endpoint, YOUTUBE_API);
  Object.entries(params).forEach(([name,value]) => url.searchParams.set(name, String(value)));
  url.searchParams.set('key', key);
  return fetchJson(url, 8500);
}
function safeHost(raw) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[0-9.]+$/.test(host) || host.includes('..')) return null;
    return url.origin;
  } catch { return null; }
}
function instances() {
  const raw = process.env.INVIDIOUS_INSTANCES;
  // Optional override: comma-separated HTTPS origins. Blank => maintained defaults.
  const list = raw && raw.trim() ? raw.split(',') : OFFICIAL_INSTANCES;
  return [...new Set(list.map(safeHost).filter(Boolean))].slice(0, 5);
}
function pageForInvidious(pageToken) {
  if (!pageToken) return 1;
  const match = INV_TOKEN_OK.exec(pageToken);
  return match ? Number(match[1]) : 1;
}
function userSearchTerm(search, category) {
  if (!search) return SEARCH_TERMS[category] || '';
  if (category === 'Klipler') return `${search} official music video klip`;
  if (category === 'Canlı') return `${search} live performance`;
  if (category === 'Shorts') return `${search} #shorts`;
  return search;
}
async function tryInvidious(path, params, expected='array') {
  const available = instances();
  if (!available.length) throw apiError('Alternatif video sunucusu ayarlanmamış.', 'INVIDIOUS_NOT_CONFIGURED');
  const now = Date.now();
  const ready = available.filter(host => (hostCooldown.get(host) || 0) <= now);
  if (!ready.length) {
    const soonest = Math.min(...available.map(host => hostCooldown.get(host) || now));
    throw apiError('Alternatif sunucular kısa süreliğine sınırlandırıldı.', 'INVIDIOUS_RATE_LIMIT', 429, Math.max(30, Math.ceil((soonest-now)/1000)));
  }
  let lastError;
  // Maximum two upstream hosts per request; do not hammer public instances.
  for (const host of ready.slice(0, 2)) {
    try {
      const url = new URL(path, host);
      Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));
      const data = await fetchJson(url, 5500);
      if (expected === 'array' ? !Array.isArray(data) : Array.isArray(data) || !data.videoId) throw apiError('Sunucudan beklenmeyen veri geldi.', 'INVALID_RESPONSE', 502);
      hostCooldown.delete(host);
      return data;
    } catch (e) {
      lastError = e;
      const secs = e.status === 429 ? Math.max(120, e.wait || 120) : 45;
      hostCooldown.set(host, Date.now() + secs * 1000);
      console.warn('[Pikniktup] Invidious unavailable:', new URL(host).hostname, e.status || e.code || 'network');
    }
  }
  throw apiError('Alternatif arama sunucuları şu an yanıt vermiyor. Biraz sonra yeniden dene.', 'INVIDIOUS_UNAVAILABLE', 503, lastError?.status === 429 ? Math.max(60, lastError.wait || 120) : 45);
}
async function invidiousSearch(term, category, page) {
  const results = await tryInvidious('/api/v1/search', {q: term, type: 'video', region: 'TR', page, sort_by: 'relevance'});
  const items = normalizeResults(results.map(fromInvidious).filter(Boolean), category);
  return {
    items, has_more: results.length >= 20 && page < 100,
    next_page_token: results.length >= 20 && page < 100 ? `iv_${page + 1}` : '',
    source: 'Invidious', category
  };
}
async function invidiousTrending(category) {
  if (category !== 'Karışık') return invidiousSearch(userSearchTerm('', category), category, 1);
  const results = await tryInvidious('/api/v1/trending', {region: 'TR'});
  return {items: normalizeResults(results.map(fromInvidious).filter(Boolean), category), has_more:false, next_page_token:'', source:'Invidious', category};
}
async function invidiousDetails(id) {
  const video = await tryInvidious(`/api/v1/videos/${id}`, {}, 'object');
  const item = fromInvidious(video);
  return {item, items:item?[item]:[],has_more:false,source:'Invidious'};
}
async function officialDetails(id, key) {
  const response = await ytFetch('videos', {part:'snippet,contentDetails,statistics,status',id}, key);
  const item = (response.items || []).map(fromYouTube).find(Boolean) || null;
  return {item,items:item?[item]:[],has_more:false,source:'YouTube'};
}
async function officialTrending(category, pageToken, key) {
  const params = {part:'snippet,contentDetails,statistics,status',chart:'mostPopular',regionCode:'TR',maxResults: '24'};
  if (CATEGORIES[category]) params.videoCategoryId = CATEGORIES[category];
  if (pageToken) params.pageToken = pageToken;
  const data = await ytFetch('videos', params, key);
  const items = normalizeResults((data.items || []).map(fromYouTube).filter(Boolean), category);
  return {items, has_more: Boolean(data.nextPageToken),next_page_token: data.nextPageToken || '',source:'YouTube',category};
}

// Fallback is an officially supported endpoint. It is quota-limited, and must
// never run on each keypress. The frontend submits only on Enter.
async function officialSearch(term, category, pageToken, key) {
  if (Date.now() < officialSearchBlockedUntil) {
    throw apiError('Resmî YouTube arama kotası geçici olarak doldu.', 'YOUTUBE_SEARCH_LIMIT', 429,
      Math.max(60, Math.ceil((officialSearchBlockedUntil - Date.now()) / 1000)));
  }
  const params = {part:'snippet', type:'video', q:term, maxResults:'24', regionCode:'TR',
    relevanceLanguage:'tr', safeSearch:'strict', videoEmbeddable:'true', videoSyndicated:'true'};
  if (category === 'Klipler' || category === 'Canlı') params.videoCategoryId = '10';
  if (category === 'Shorts') params.videoDuration = 'short';
  if (pageToken) params.pageToken = pageToken;
  let results;
  try {
    results = await ytFetch('search', params, key);
  } catch (error) {
    if ([403,429].includes(error.status)) {
      // Block repeated expensive calls for a while; serverless memory is best-effort.
      officialSearchBlockedUntil = Date.now() + 60 * 60 * 1000;
      throw apiError('YouTube arama kotası veya erişim sınırı', 'YOUTUBE_SEARCH_LIMIT', 429, 3600);
    }
    throw error;
  }
  const ids = [...new Set((results.items || []).map(item => item?.id?.videoId).filter(isId))];
  if (!ids.length) return {items:[], has_more:false, next_page_token:'', source:'YouTube', category};
  const details = await ytFetch('videos', {part:'snippet,contentDetails,statistics,status',
    id:ids.join(','), maxResults:String(ids.length)}, key);
  const byId = new Map((details.items || []).map(fromYouTube).filter(Boolean).map(item => [item.youtube_id, item]));
  const items = normalizeResults(ids.map(id => byId.get(id)).filter(Boolean), category);
  const more = results.nextPageToken && YT_TOKEN_OK.test(results.nextPageToken);
  return {items, has_more:Boolean(more), next_page_token:more?`yt_${results.nextPageToken}`:'', source:'YouTube',category};
}
async function resilientSearch(term, category, pageToken, key) {
  const yt = YT_PREFIX_TOKEN_OK.exec(pageToken);
  if (yt) {
    if (!key) throw apiError('YouTube API anahtarı eksik', 'YOUTUBE_SEARCH_LIMIT', 503);
    return officialSearch(term,category,yt[1],key);
  }
  if (pageToken && !INV_TOKEN_OK.test(pageToken)) {
    // Old tokens cannot be mapped safely between providers.
    throw apiError('Eski arama sayfası belirteci', 'INVALID_PAGE', 400);
  }
  try {
    return await invidiousSearch(term,category,pageForInvidious(pageToken));
  } catch (invidiousError) {
    if (pageToken || !key) throw invidiousError;
    console.warn('[Pikniktup] Invidious search failed, trying official API once:', invidiousError.code || 'network');
    return officialSearch(term,category,'',key);
  }
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.staleUntil < Date.now()) { cache.delete(key); return null; }
  return entry;
}
async function cached(key, loader, seconds=600) {
  const existing = readCache(key);
  if (existing && existing.freshUntil >= Date.now()) return {payload:existing.payload,cache:'HIT'};
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const payload = await loader();
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, {payload, freshUntil:Date.now()+seconds*1000,staleUntil:Date.now()+(seconds+3600)*1000});
      return {payload,cache:'MISS'};
    } catch (error) {
      if (existing) return {payload:{...existing.payload,warning:'STALE_FALLBACK'},cache:'STALE'};
      throw error;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, promise);
  return promise;
}
function respondError(res, error) {
  const known = new Set(['INVIDIOUS_UNAVAILABLE','INVIDIOUS_NOT_CONFIGURED','INVIDIOUS_RATE_LIMIT','YOUTUBE_SEARCH_LIMIT','VIDEO_SOURCE_UNAVAILABLE']);
  const code = known.has(error.code) || error.code === 'INVALID_PAGE' ? error.code : 'VIDEO_SOURCE_UNAVAILABLE';
  const wait = Math.max(0, Math.min(600, Math.ceil(error.wait || 0)));
  const status = error.status === 400 ? 400 : error.status === 429 ? 429 : 503;
  if (wait) res.setHeader('Retry-After', String(wait));
  res.setHeader('Cache-Control', 'no-store');
  console.warn('[Pikniktup] API request failed:', error.code || 'network', error.status || '');
  return res.status(status).json({
    error: code === 'YOUTUBE_SEARCH_LIMIT' ? 'Invidious araması yanıt vermiyor; YouTube arama kotası da dolmuş veya sınırlandırılmış. Kotanın yenilenmesini bekleyebilirsin.' : code === 'INVALID_PAGE' ? 'Sayfa belirteci eski veya geçersiz. İlk sayfaya dön.' : code === 'INVIDIOUS_NOT_CONFIGURED'
      ? 'Arama sunucusu ayarlanmamış. Vercel INVIDIOUS_INSTANCES ayarını kontrol et.'
      : 'Video kaynağı şu anda yanıt vermiyor. Biraz sonra yeniden dene.',
    code, retry_after_seconds: wait
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Yalnızca GET kullanılabilir',code:'METHOD_NOT_ALLOWED'});
  }
  if (req.query?.health === '1') {
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({version:VERSION, engine:'Invidious search + official YouTube fallback + YouTube trending',invidiousConfigured:instances().length > 0,youtubeKeyConfigured:Boolean(process.env.YOUTUBE_API_KEY)});
  }
  const query = req.query || {};
  const id = query.id;
  const requestedSearch = query.search;
  if (id !== undefined && !isId(id)) return res.status(400).json({error:'Geçersiz video kimliği',code:'INVALID_ID'});
  if (requestedSearch !== undefined && typeof requestedSearch !== 'string') return res.status(400).json({error:'Geçersiz arama',code:'INVALID_SEARCH'});
  const search = cut(requestedSearch,75).normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g,' ').trim();
  if (requestedSearch !== undefined && search.length < 2) return res.status(400).json({error:'En az iki karakter yaz',code:'SEARCH_TOO_SHORT'});
  const category = typeof query.category === 'string' && (CATEGORIES[query.category] || SPECIAL.has(query.category)) ? query.category : 'Karışık';
  const pageToken = typeof query.pageToken === 'string' ? query.pageToken : '';
  if (query.pageToken !== undefined && (!pageToken || (!INV_TOKEN_OK.test(pageToken) && !YT_PREFIX_TOKEN_OK.test(pageToken) && !YT_TOKEN_OK.test(pageToken)))) {
    return res.status(400).json({error:'Geçersiz sayfa belirteci',code:'INVALID_PAGE'});
  }
  // CDN caching is cross-invocation; the in-process cache additionally coalesces concurrent requests.
  res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
  const key = process.env.YOUTUBE_API_KEY;
  const mode = id ? 'details' : search || SPECIAL.has(category) || category === 'Film/Dizi' || INV_TOKEN_OK.test(pageToken) || YT_PREFIX_TOKEN_OK.test(pageToken) ? 'search' : 'trending';
  const cacheKey = JSON.stringify([mode,id||'',search,category,pageToken]);
  try {
    const {payload,cache:cacheLabel} = await cached(cacheKey, async () => {
      if (mode === 'search') {
        const term = userSearchTerm(search,category);
        return resilientSearch(term,category,pageToken,key);
      }
      if (mode === 'details') {
        if (key) {
          try { return await officialDetails(id,key); }
          catch (e) { console.warn('[Pikniktup] YouTube details fallback:',e.status||e.code); }
        }
        return invidiousDetails(id);
      }
      if (key && !INV_TOKEN_OK.test(pageToken)) {
        try { return await officialTrending(category,pageToken,key); }
        catch (e) { console.warn('[Pikniktup] YouTube trending fallback:',e.status||e.code); }
      }
      if (pageToken) throw apiError('Alternatif kaynak, bu sayfayı desteklemiyor', 'INVALID_PAGE',400);
      return invidiousTrending(category);
    }, mode === 'search' ? 900 : mode === 'details' ? 900 : 600);
    res.setHeader('X-Pikniktup-Cache',cacheLabel);
    return res.status(200).json(payload);
  } catch (error) {
    return respondError(res,error);
  }
};
