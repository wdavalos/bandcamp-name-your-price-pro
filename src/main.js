import { Actor, log } from 'apify';
import { CheerioCrawler, RequestList } from 'crawlee';
import { gotScraping } from 'got-scraping';

const SEARCH_API = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ENTITIES = { '&quot;': '"', '&amp;': '&', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
function decodeEntities(s) {
    let out = String(s);
    for (const [ent, ch] of Object.entries(ENTITIES)) out = out.split(ent).join(ch);
    return out;
}
function stripHtml(s) {
    return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function parseDuration(d) {
    if (d == null) return 0;
    if (typeof d === 'number') return d;
    const parts = String(d).split(':').map((p) => parseFloat(p) || 0);
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return Math.round(sec);
}

// one search -> album URLs
async function searchAlbums(query) {
    try {
        const res = await gotScraping({
            url: SEARCH_API,
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            json: { search_text: query, search_filter: 'a', fan_id: null, full_page: true },
            timeout: { request: 30000 },
            retry: { limit: 2 },
        });
        const parsed = JSON.parse(res.body);
        const results = parsed?.auto?.results || [];
        return results
            .filter((i) => i.type === 'a' && i.item_url_path)
            .map((i) => ({ url: i.item_url_path, foundVia: { type: 'search', value: query } }));
    } catch (err) {
        log.warning(`search "${query}" failed: ${err.message}`);
        return [];
    }
}

// artist/label page -> discography URLs
async function artistDiscography(bandUrl) {
    const clean = bandUrl.replace(/\/+$/, '');
    const pageUrl = clean.replace(/\/music$/, '') + '/music';
    try {
        const res = await gotScraping({
            url: pageUrl,
            timeout: { request: 30000 },
            retry: { limit: 1 },
        });
        const body = res.body;
        const root = pageUrl.match(/^https:\/\/[^/]+/)[0];
        const found = new Map();
        const re = /href="(\/(?:album|track)\/[^"?#]+)"/g;
        let m;
        while ((m = re.exec(body)) !== null) found.set(root + m[1], true);
        return [...found.keys()].map((url) => ({ url, foundVia: { type: 'artist', value: bandUrl } }));
    } catch (err) {
        log.warning(`discography ${bandUrl} failed: ${err.message}`);
        return [];
    }
}

await Actor.init();

const {
    searchQueries = ['ambient', 'lo-fi', 'experimental', 'field recording'],
    artistUrls = [],
    albumUrls = [],
    includeFree = false,
    maxItems = 500,
    proxyConfiguration: proxyInput = {},
} = (await Actor.getInput()) || {};

const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);

// ---- discovery ----
const queue = new Map(); // url -> foundVia
const cap = Math.max(100, Math.ceil(maxItems * 1.2));

const addAll = (entries) => {
    for (const e of entries) {
        if (!e.url || queue.has(e.url)) continue;
        if (queue.size >= cap) return;
        queue.set(e.url, e.foundVia);
    }
};

for (const q of searchQueries.slice(0, 50)) addAll(await searchAlbums(String(q).trim()).catch(() => []));
for (const u of artistUrls.slice(0, 50)) addAll(await artistDiscography(String(u).trim()).catch(() => []));
for (const u of albumUrls.slice(0, 500)) {
    const url = String(u).trim();
    if (url && !queue.has(url)) queue.set(url, { type: 'direct', value: url });
}
log.info(`discovery: ${queue.size} candidate URLs`);

// ---- check each release page ----
let pushed = 0;
let checked = 0;
let nyop = 0;
let free = 0;

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 4,
    maxRequestRetries: 2,
    navigationTimeoutSecs: 60,
    additionalMimeTypes: ['application/xml'],
    requestHandlerTimeoutSecs: 90,
    requestHandler: async ({ request, body, $ }) => {
        if (pushed >= maxItems) return;
        checked++;
        const html = body ? body.toString() : $.html();
        const attrMatch = html.match(/data-tralbum="([^"]+)"/);
        if (!attrMatch) {
            log.info(`no tralbum data on ${request.url}`);
            return;
        }
        let t;
        try {
            t = JSON.parse(decodeEntities(attrMatch[1]));
        } catch (err) {
            log.info(`bad tralbum json on ${request.url}`);
            return;
        }

        const cur = t.current || {};
        const dp = cur.download_pref;
        const minPrice = Number(cur.minimum_price ?? 0) || 0;
        const hasFreePage = t.freeDownloadPage != null;

        let mode = null;
        if (dp === 2 && minPrice === 0) mode = 'name_your_price';
        else if (dp === 1 || hasFreePage) mode = 'free';
        if (!mode) return; // fixed price or no digital download: not our target
        if (mode === 'free' && !includeFree) return;

        const pageUrl = t.url || request.url;
        let currency = 'USD';
        try {
            const blobMatch = html.match(/<div id="pagedata" data-blob="([^"]+)"/);
            if (blobMatch) {
                const pagedata = JSON.parse(decodeEntities(blobMatch[1]));
                const sellers = Object.values(pagedata.item_sellers || {});
                if (sellers[0]?.currency) currency = sellers[0].currency;
            }
        } catch { /* currency stays USD */ }

        const tags = [];
        $('a.tag').each((_, el) => {
            const href = $(el).attr('href') || '';
            const tagMatch = href.match(/\/(?:tag|discover)\/([^/?#]+)/);
            if (tagMatch) {
                const tag = decodeURIComponent(tagMatch[1]).trim();
                if (tag && !tags.includes(tag)) tags.push(tag);
            }
        });
        if (!tags.length && Array.isArray(t.tags)) {
            for (const tag of t.tags) if (typeof tag === 'string' && !tags.includes(tag)) tags.push(tag);
        }

        const trackinfo = Array.isArray(t.trackinfo) ? t.trackinfo : [];
        let total = 0;
        const tracks = [];
        for (const tr of trackinfo.slice(0, 100)) {
            const dur = parseDuration(tr.duration);
            total += dur;
            tracks.push({ title: stripHtml(tr.title), duration: tr.duration ?? null });
        }

        const releaseRaw = t.album_release_date || t.release_date || null;
        let releaseDate = null;
        if (releaseRaw) {
            const d = new Date(releaseRaw.replace(' GMT', ''));
            if (!Number.isNaN(d.getTime())) releaseDate = d.toISOString().slice(0, 10);
        }

        const item = {
            url: pageUrl,
            artist: stripHtml(t.artist) || null,
            albumTitle: stripHtml((t.current && t.current.title) || t.item_title || t.title) || null,
            label: t.publisher ? stripHtml(t.publisher) : null,
            pricingMode: mode,
            minimumPrice: mode === 'name_your_price' ? 0 : 0,
            currency,
            releaseDate,
            isPreorder: !!t.album_is_preorder,
            tags,
            trackCount: trackinfo.length,
            totalDurationSec: total || null,
            tracks,
            license: $('#license').text().replace(/\s+/g, ' ').trim() || null,
            about: stripHtml(t.about).slice(0, 400) || null,
            credits: stripHtml(t.credits).slice(0, 300) || null,
            bandUrl: (pageUrl.match(/^(https:\/\/[^/]+)/) || [])[1] || null,
            foundVia: request.userData?.foundVia || null,
        };

        await Actor.pushData(item);
        pushed++;
        if (mode === 'name_your_price') nyop++;
        else free++;
    },
    failedRequestHandler: ({ request }, err) => {
        log.info(`gave up on ${request.url}: ${err.message}`);
    },
});

const requests = [...queue.entries()].map(([url, foundVia]) => ({ url, userData: { foundVia } }));
const requestList = await RequestList.open('bandcamp-urls', requests);
await crawler.run(requestList);

log.info(`done: checked ${checked}, pushed ${pushed} (name-your-price ${nyop}, free ${free})`);
await Actor.exit();
