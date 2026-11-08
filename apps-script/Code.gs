/** FitMe MVP — finds in-stock clothes in your size across Shopify brand stores. */

const STORES = [
  { name: 'Taylor Stitch',        host: 'www.taylorstitch.com',       g: 'both' },
  { name: 'Bonobos',              host: 'www.bonobos.com',            g: 'm' },
  { name: 'Mugsy',                host: 'www.mugsy.com',              g: 'm' },
  { name: 'Frame',                host: 'www.frame-store.com',        g: 'both' },
  { name: 'Outerknown',           host: 'www.outerknown.com',         g: 'both' },
  { name: 'Everlane',             host: 'www.everlane.com',           g: 'both' },
  { name: 'Kit and Ace',          host: 'www.kitandace.com',          g: 'both' },
  { name: 'Ministry of Supply',   host: 'www.ministryofsupply.com',   g: 'both' },
  { name: 'Agolde',               host: 'www.agolde.com',             g: 'both' },
  { name: 'Citizens of Humanity', host: 'www.citizensofhumanity.com', g: 'both' },
  { name: 'Mother',               host: 'www.motherdenim.com',        g: 'w' },
  { name: 'Girlfriend Collective',host: 'www.girlfriend.com',         g: 'w' },
  { name: 'Alo',                  host: 'www.aloyoga.com',            g: 'both' },
  { name: 'Skims',                host: 'www.skims.com',              g: 'w' },
];
const PAGES = 2;               // 250 products per page
const CACHE_SECONDS = 6 * 3600; // store data refreshes every 6 hours

function doGet(e) {
  // JSON API for the public page (GitHub Pages): ?api=search&p=<profile JSON>
  if (e && e.parameter && e.parameter.api === 'search') {
    let P = {};
    try { P = JSON.parse(e.parameter.p || '{}'); } catch (err) {}
    let out;
    try { out = search(P); } catch (err) { out = { error: String(err && err.message || err) }; }
    return json_(out);
  }
  if (e && e.parameter && e.parameter.api === 'tryon_status') {
    return json_(tryOnCheck_(e.parameter.s, e.parameter.r));
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FitMe')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- catalog ---------- */

// The 10 style words shoppers use most, matched against title, type and tags.
const STYLES = {
  casual:     /\b(tee|tees|t-shirt|hoodie|sweatshirt|jeans?|denim|chinos?|shorts|henley|flannel|crew|crewneck|casual|joggers?|everyday|weekend)\b/,
  business:   /\b(blazers?|trousers?|oxford|button[- ]down|dress shirt|polo|cardigan|sweater|work|office|business|pleated|tailored|merino|slacks)\b/,
  formal:     /\b(suit|suiting|tux|tuxedo|blazer|dress pants?|dress shirt|gown|cocktail|formal|silk|satin|evening|tailored)\b/,
  streetwear: /\b(hoodie|graphic|cargo|oversized|joggers?|track|bomber|street|boxy|sweatshirt|puffer|utility)\b/,
  athleisure: /\b(leggings?|joggers?|sweatpants?|active|performance|yoga|tank|track|tech|run|running|train|training|gym|stretch|athletic|sport|bike shorts?)\b/,
  minimalist: /\b(essentials?|basics?|minimal|classic|clean|everyday|cashmere|organic cotton|ribbed|black|white|ivory|cream|neutral)\b/,
  boho:       /\b(boho|floral|peasant|crochet|embroidered|linen|flowy|maxi|tiered|printed|fringe|paisley|smocked|ruffle)\b/,
  preppy:     /\b(polo|oxford|cable|chinos?|cardigan|pleated|plaid|stripe|striped|rugby|quarter[- ]zip|varsity|tweed|argyle|seersucker)\b/,
  vintage:    /\b(vintage|retro|washed|faded|70s|90s|worn|heritage|corduroy|cord|selvedge|distressed|outerworn|raw|garment[- ]dyed|archive)\b/,
  edgy:       /\b(leather|moto|biker|distressed|ripped|chain|chainmail|studded|mesh|grunge|cutout|cut-out|sheer|corset)\b/
};
const SEASONS = {
  fall:   /\b(sweaters?|knit|flannel|cardigan|overshirt|shacket|jackets?|corduroy|cord|wool|hoodie|sweatshirt|long[- ]sleeve|henley|turtleneck|suede|vest|quilted|fleece|plaid|merino)\b/,
  winter: /\b(coats?|parka|puffer|down|wool|cashmere|sherpa|fleece|thermal|turtleneck|quilted|knit|sweaters?|flannel|insulated|heavyweight)\b/,
  spring: /\b(linen|light|lightweight|trench|chambray|oxford|poplin|chinos?|cropped|crop|short[- ]sleeve|tee|cardigan|floral|denim)\b/,
  summer: /\b(shorts|tank|linen|tee|t-shirt|sleeveless|camp collar|sundress|mini|crop|lightweight|seersucker|polo|short[- ]sleeve)\b/
};
const DAY = 864e5;

const EXCLUDE = /\b(kids?|boys?|girls?|baby|toddler|youth|shoes?|sneakers?|boots?|sandals?|socks?|bags?|totes?|hats?|caps?|beanies?|belts?|wallets?|gift ?cards?|candles?|masks?|jewelry|sunglasses|bottles?|mats?|scarf|scarves|gloves?|underwear|boxers?|briefs?|bras?|thongs?|swim\w*)\b/;

function category_(t) {
  if (/\b(jackets?|coats?|parkas?|vests?|blazers?|outerwear|anoraks?|shackets?|overshirts?)\b/.test(t)) return 'outerwear';
  if (/\b(dress|dresses|jumpsuits?|rompers?)\b/.test(t) && !/dress shirt/.test(t)) return 'dresses';
  if (/\b(pants?|jeans?|shorts|leggings?|trousers?|chinos?|joggers?|skirts?|sweatpants?|flares?|bootcut|bottoms?)\b/.test(t)) return 'bottoms';
  return 'tops';
}

function gender_(store, t) {
  if (store.g !== 'both') return store.g;
  const w = /\b(wom[ae]n'?s?|womens|ladies)\b/.test(t);
  const m = /\b(m[ae]n'?s?|mens)\b/.test(t);
  if (w && !m) return 'w';
  if (m && !w) return 'm';
  return 'u';
}

function slim_(store, p) {
  const title = String(p.title || '');
  const type = String(p.product_type || '');
  const tags = (Array.isArray(p.tags) ? p.tags.join(' ') : String(p.tags || ''));
  const t = (title + ' ' + type + ' ' + tags).toLowerCase();
  if (EXCLUDE.test((title + ' ' + type).toLowerCase())) return null;
  const opts = (p.options || []).map(o => String(o.name || '').toLowerCase());
  const rel = [];
  opts.forEach((n, i) => { if (/size|waist|length|inseam/.test(n)) rel.push(i); });
  if (!rel.length) return null;
  const seen = {};
  (p.variants || []).forEach(v => {
    if (!v.available) return;
    const vals = [v.option1, v.option2, v.option3];
    const key = rel.map(i => String(vals[i] == null ? '' : vals[i])).join('|');
    const price = parseFloat(v.price) || 0;
    if (!(key in seen) || price < seen[key]) seen[key] = price;
  });
  const v = Object.keys(seen).map(k => [k, seen[k]]);
  if (!v.length) return null;
  let img = (p.images && p.images[0] && p.images[0].src) || '';
  if (img) img += (img.indexOf('?') > -1 ? '&' : '?') + 'width=480';
  return {
    b: store.name, h: store.host, u: p.handle, t: title, ty: type,
    n: rel.map(i => opts[i]), v: v, img: img,
    g: gender_(store, t), k: category_((title + ' ' + type).toLowerCase()),
    st: Object.keys(STYLES).filter(k => STYLES[k].test(t)),
    se: Object.keys(SEASONS).filter(k => SEASONS[k].test(t)),
    d: Math.floor(Date.parse(p.published_at || p.created_at || '') / DAY) || 0
  };
}

function loadCatalog_() {
  const cache = CacheService.getScriptCache();
  const all = [], failed = [], missing = [];
  STORES.forEach(s => {
    const got = getChunked_(cache, 'c3_' + s.host);
    if (got) all.push.apply(all, got); else missing.push(s);
  });
  if (missing.length) {
    const reqs = [], owners = [];
    missing.forEach(s => {
      for (let p = 1; p <= PAGES; p++) {
        reqs.push({ url: 'https://' + s.host + '/products.json?limit=250&page=' + p,
                    muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 TapeAndFit/1.0' } });
        owners.push(s);
      }
    });
    const res = UrlFetchApp.fetchAll(reqs);
    const byStore = {};
    res.forEach((r, i) => {
      const s = owners[i];
      byStore[s.host] = byStore[s.host] || { s: s, items: [], ok: false };
      if (r.getResponseCode() !== 200) return;
      try {
        const j = JSON.parse(r.getContentText());
        byStore[s.host].ok = true;
        (j.products || []).forEach(p => { const x = slim_(s, p); if (x) byStore[s.host].items.push(x); });
      } catch (e) {}
    });
    Object.keys(byStore).forEach(h => {
      const o = byStore[h];
      if (!o.ok) { failed.push(o.s.name); return; }
      try { putChunked_(cache, 'c3_' + h, o.items); } catch (e) {}
      all.push.apply(all, o.items);
    });
  }
  return { all: all, failed: failed };
}

function putChunked_(cache, key, obj) {
  const s = JSON.stringify(obj), size = 40000, n = Math.max(1, Math.ceil(s.length / size)), m = {};
  for (let i = 0; i < n; i++) m[key + '_' + i] = s.substr(i * size, size);
  m[key + '_n'] = String(n);
  cache.putAll(m, CACHE_SECONDS);
}
function getChunked_(cache, key) {
  const n = cache.get(key + '_n');
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < +n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let s = '';
  for (const k of keys) { if (got[k] == null) return null; s += got[k]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* ---------- size matching ---------- */

const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
function normLetter_(x) {
  x = x.toUpperCase().replace(/\s/g, '');
  const map = { '2XS': 'XXS', 'XXXS': 'XXS', '2XL': 'XXL', 'XXXL': '3XL', 'SMALL': 'S', 'MEDIUM': 'M', 'LARGE': 'L', 'X-LARGE': 'XL', 'XLARGE': 'XL', 'XX-LARGE': 'XXL', 'X-SMALL': 'XS', 'XSMALL': 'XS' };
  return map[x] || x;
}

function partFits_(name, val, prod, P) {
  const s = String(val || '').trim();
  if (!s) return true;
  const low = s.toLowerCase();
  if (/^(one size|os|o\/s|onesize)$/.test(low)) return true;
  const isLen = /length|inseam/.test(name);

  // 32x30, 32 / 30, 32W 30L
  let m = low.match(/^(\d{2})\s*w?\s*[x\/]\s*(\d{2})\s*l?$/);
  if (m) return numFits_(+m[1], false, prod, P) && Math.abs(+m[2] - P.inseam) <= 1;

  if (isLen) {
    const n = parseFloat(low);
    if (/petite|short/.test(low)) return P.inseam < 29;
    if (/tall|long/.test(low)) return P.inseam > 32.5;
    if (/regular|standard/.test(low)) return P.inseam >= 29 && P.inseam <= 32.5;
    if (!isNaN(n) && n >= 25 && n <= 38) return Math.abs(n - P.inseam) <= 1;
    return true; // unknown length scheme: don't filter on it
  }

  // letter sizes, incl. "XS - 36", "S/M", "Small"
  m = s.toUpperCase().match(/^(XXXS|XXS|2XS|XS|X-SMALL|SMALL|MEDIUM|LARGE|X-LARGE|XX-LARGE|XXXL|3XL|2XL|XXL|XL|S|M|L)(\s*\/\s*(XXS|XS|S|M|L|XL|XXL))?\b/);
  if (m) {
    const want = prod.k === 'bottoms' ? P.bottom : P.top;
    const opts = [normLetter_(m[1])];
    if (m[3]) opts.push(normLetter_(m[3]));
    return opts.indexOf(want) > -1;
  }

  const n = parseFloat(low);
  if (!isNaN(n) && /^\d+(\.\d)?\b/.test(low)) return numFits_(n, /waist/.test(name), prod, P);
  return false;
}

function numFits_(n, isWaist, prod, P) {
  if (P.g === 'w') {
    if (n <= 20) return n === P.dress;            // 0–20 dress/pant sizing
    if (n >= 22 && n <= 36) return n === P.jean;  // denim waist sizing
    return false;
  }
  if (n <= 20) return false;
  if (!isWaist && (prod.k === 'tops' || prod.k === 'outerwear') && n >= 34 && n <= 52) return n === P.jacket;
  if (n >= 26 && n <= 50) return n === P.waist;
  return false;
}

/** Called from the page. P = shopper profile with sizes already worked out.
 *  P.cat, P.q, P.styles [..], P.maxPrice, P.mode ('new' = newest first), P.season */
function search(P) {
  const cat = loadCatalog_();
  const words = String(P.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const styles = Array.isArray(P.styles) ? P.styles : [];
  const today = Math.floor(Date.now() / DAY);
  const isNew = P.mode === 'new';
  const out = [];
  const byCat = { all: 0, tops: 0, bottoms: 0, outerwear: 0, dresses: 0, under100: 0 };
  const byStyle = {}; Object.keys(STYLES).forEach(k => byStyle[k] = 0);
  cat.all.forEach(prod => {
    if (prod.g !== P.g && prod.g !== 'u') return;
    if (isNew && P.season && (prod.se || []).indexOf(P.season) < 0) return;
    if (words.length) {
      const hay = (prod.b + ' ' + prod.t + ' ' + prod.ty).toLowerCase();
      if (!words.every(w => hay.indexOf(w) > -1)) return;
    }
    const sizes = [];
    let min = Infinity;
    prod.v.forEach(([key, price]) => {
      const parts = key.split('|');
      if (parts.every((val, i) => partFits_(prod.n[i], val, prod, P))) {
        const label = parts.filter(Boolean).join(' · ');
        if (sizes.indexOf(label) < 0) sizes.push(label);
        if (price < min) min = price;
      }
    });
    if (!sizes.length) return;
    byCat.all++; byCat[prod.k] = (byCat[prod.k] || 0) + 1; if (min < 100) byCat.under100++;
    if (P.cat === 'under100') { if (min >= 100) return; }
    else if (P.cat && P.cat !== 'all' && prod.k !== P.cat) return;
    if (P.maxPrice && min > P.maxPrice) return;
    (prod.st || []).forEach(k => byStyle[k]++);
    if (styles.length && !(prod.st || []).some(k => styles.indexOf(k) > -1)) return;
    out.push({ brand: prod.b, title: prod.t, img: prod.img, price: min, sizes: sizes.slice(0, 4),
               url: 'https://' + prod.h + '/products/' + prod.u, cat: prod.k, styles: prod.st || [],
               age: prod.d ? today - prod.d : null });
  });
  let list;
  if (isNew) {
    list = out.sort((a, b) => (a.age == null ? 1e9 : a.age) - (b.age == null ? 1e9 : b.age)).slice(0, 120);
  } else {
    // interleave brands so one store doesn't dominate
    const by = {};
    out.forEach(x => (by[x.brand] = by[x.brand] || []).push(x));
    const lists = Object.keys(by).map(k => by[k]);
    list = [];
    for (let i = 0; list.length < 120 && lists.some(l => l[i]); i++) lists.forEach(l => { if (l[i] && list.length < 120) list.push(l[i]); });
  }
  return { items: list, total: out.length, byCat: byCat, byStyle: byStyle, failed: cat.failed, stores: STORES.length };
}

/** Run once from the editor to warm the cache and check stores. */
function testSearch() {
  const c = loadCatalog_();
  console.log('products loaded: ' + c.all.length + ' | failed stores: ' + (c.failed.join(', ') || 'none'));
  ['m','w'].forEach(g => {
    const P = g === 'm' ? { g:'m', top:'M', bottom:'M', waist:33, inseam:32, jacket:40, cat:'all', q:'' }
                        : { g:'w', top:'S', bottom:'S', dress:6, jean:27, inseam:30, cat:'all', q:'' };
    const r = search(P);
    console.log(g + ': ' + r.total + ' matches ' + JSON.stringify(r.byCat) + ' styles ' + JSON.stringify(r.byStyle));
    const n = search(Object.assign({}, P, { mode: 'new', season: 'fall' }));
    console.log(g + ' new fall: ' + n.total + ' | newest: ' + n.items.slice(0, 3).map(x => x.brand + ' ' + x.title + ' (' + x.age + 'd)').join('; '));
    r.items.slice(0, 6).forEach(x => console.log('  ' + x.brand + ' | ' + x.title + ' | $' + x.price + ' | ' + x.sizes.join(', ')));
  });
}


/* ---------- photo try-on (FASHN v1.6 via fal.ai) ----------
 * Setup: Project Settings > Script Properties > add FAL_KEY = your fal.ai API key.
 * Optional: TRYON_DAILY_CAP (default 300 try-ons per day across all users).
 */
const FAL_TRYON = 'https://queue.fal.run/fal-ai/fashn/tryon/v1.6';

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (body.api === 'tryon') return json_(tryOnStart_(body));
  return json_({ error: 'Unknown request.' });
}

function tryOnStart_(b) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('FAL_KEY');
  if (!key) return { error: "Try-on isn't switched on yet." };
  const person = String(b.person || ''), garment = String(b.garment || '');
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(person) || person.length > 4e6) return { error: 'Your photo could not be read. Try a different photo.' };
  if (!/^https:\/\//.test(garment)) return { error: 'This item has no photo to try on.' };
  const cats = { tops: 'tops', outerwear: 'tops', bottoms: 'bottoms', dresses: 'one-pieces' };
  // daily spending cap across all visitors
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (err) { return { error: 'Busy right now. Try again in a moment.' }; }
  try {
    const day = 'tryon_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
    const used = +(props.getProperty(day) || 0), cap = +(props.getProperty('TRYON_DAILY_CAP') || 300);
    if (used >= cap) return { error: "Today's try-on limit is reached. Try again tomorrow." };
    props.setProperty(day, String(used + 1));
  } finally { lock.releaseLock(); }
  const res = UrlFetchApp.fetch(FAL_TRYON, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Key ' + key },
    payload: JSON.stringify({ model_image: person, garment_image: garment, category: cats[b.category] || 'auto',
      mode: 'balanced', garment_photo_type: 'auto', moderation_level: 'permissive', output_format: 'jpeg' })
  });
  if (res.getResponseCode() >= 300) {
    let why = ''; try { const d = JSON.parse(res.getContentText()); why = String(d.detail && (d.detail.msg || d.detail[0] && d.detail[0].msg || d.detail) || d.message || '').slice(0, 160); } catch (err) { why = res.getContentText().slice(0, 160); }
    return { error: 'The try-on service said no (' + res.getResponseCode() + (why ? ': ' + why : '') + ').' };
  }
  const j = JSON.parse(res.getContentText());
  return { status: j.status_url, result: j.response_url };
}

function tryOnCheck_(statusUrl, resultUrl) {
  const key = PropertiesService.getScriptProperties().getProperty('FAL_KEY');
  const ok = u => /^https:\/\/queue\.fal\.run\//.test(String(u || ''));
  if (!key || !ok(statusUrl) || !ok(resultUrl)) return { error: 'Bad request.' };
  const h = { headers: { Authorization: 'Key ' + key }, muteHttpExceptions: true };
  const s = UrlFetchApp.fetch(statusUrl, h);
  if (s.getResponseCode() >= 300 && s.getResponseCode() !== 202) return { error: 'Lost track of this try-on. Try again.' };
  const st = JSON.parse(s.getContentText() || '{}').status;
  if (st !== 'COMPLETED') return { done: false, status: st || 'IN_QUEUE' };
  const r = UrlFetchApp.fetch(resultUrl, h);
  const j = JSON.parse(r.getContentText() || '{}');
  const url = j.images && j.images[0] && j.images[0].url;
  if (!url) return { error: (j.detail && (j.detail[0] && j.detail[0].msg || j.detail)) ? 'The photo was not accepted. Try a clear full-body photo.' : 'No image came back. Try again.' };
  return { done: true, url: url };
}
