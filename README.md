# Bandcamp Name Your Price Pro

Finds Bandcamp releases priced **name your price** (buyers pick the price, minimum $0) and, optionally, releases artists give away for free. Search by keyword, or point it at any artist or label discography and it checks every release.

Every result comes straight from Bandcamp's own pricing data for that release, so what you get is what the artist actually set, not a guess from a listing.

## Why this actor

Unlike generic Bandcamp scrapers that dump every release and leave you to figure out pricing yourself, this actor is built around one question: **which releases can I name my own price for?** It reads each release's pricing mode from Bandcamp's own data and filters out anything with a fixed price.

Use cases: music discovery and A&R research, building pay-what-you-want playlists and libraries, netlabel and indie-scene research, catalog price monitoring, and anything else that needs pay-what-you-want catalogs at scale.

## What it returns

One row per name-your-price (or free) release:

| Field | What it is |
| --- | --- |
| `url` | Album or track page URL |
| `artist` | Artist name |
| `albumTitle` | Release title |
| `label` | Label or publisher, when Bandcamp records one |
| `pricingMode` | `name_your_price` or `free` |
| `minimumPrice` | Minimum buyers can pay (0 for name your price) |
| `currency` | The seller's currency |
| `releaseDate` | Release date (ISO) |
| `isPreorder` | Whether it is a preorder |
| `tags` | Genre tags on the release |
| `trackCount`, `tracks` | Track list with durations |
| `totalDurationSec` | Total runtime in seconds |
| `license` | License text shown on the release |
| `about` | Release notes (first 400 characters) |
| `credits` | Release credits (first 300 characters) |
| `bandUrl` | The artist's Bandcamp page |
| `foundVia` | How this release was found: search query, artist scan, or direct URL |

## Input

| Option | Default | What it does |
| --- | --- | --- |
| `searchQueries` | `["ambient", "lo-fi", "experimental", "field recording"]` | Keywords to search Bandcamp with (up to 50 queries, 50 results each) |
| `artistUrls` | empty | Artist or label page URLs; every album and track in that discography gets checked |
| `albumUrls` | empty | Direct album or track URLs to check |
| `includeFree` | `false` | Also return releases artists give away free |
| `maxItems` | `500` | Stop after this many results |

Run one of the three discovery inputs, or mix them. Searching finds artists and scenes you didn't know about; artist scans answer "is anything in this catalog name your price?".

## Pricing

This actor bills pay-per-event:

| Event | Price |
| --- | --- |
| Actor start | $0.005 |
| Per result | $0.005 |

That is **$5.00 per 1,000 name-your-price releases found**. A 500-result run costs about $2.51. Comparable Bandcamp actors charge $2-$5 per 1,000 results for unfiltered catalogs; here you pay per filtered result that is actually name your price.

## Example

Input `searchQueries: ["lo-fi"]` returns rows like:

```json
{
  "url": "https://example.bandcamp.com/album/winter-tapes",
  "artist": "Example Artist",
  "albumTitle": "Winter Tapes",
  "pricingMode": "name_your_price",
  "minimumPrice": 0,
  "currency": "USD",
  "releaseDate": "2026-01-17",
  "tags": ["lo-fi", "bedroom pop"],
  "trackCount": 8,
  "foundVia": { "type": "search", "value": "lo-fi" }
}
```

## FAQ

**What counts as "name your price"?**
Any release where the artist lets buyers set their own price with a $0 minimum. Free downloads are a separate mode and are off unless you set `includeFree`.

**Why is my favorite fixed-price album missing?**
It is filtered on purpose. Fixed-price releases are exactly what this actor removes. To check one specific release, use `albumUrls`, and it is skipped unless it is name your price.

**Where does the pricing data come from?**
From Bandcamp's own data on each release page, the same source the buy button uses. If an artist changes their price, the next run reflects it.

**Does it need a proxy?**
No, Bandcamp release pages are public. Add one in `proxyConfiguration` if your setup needs it.

**How many results can one run get?**
Each search query returns up to 50 results, so 10 queries is up to 500 candidates. Artist scans cover a full discography. Set `maxItems` to your budget.

**Does it include tracks as well as albums?**
Search finds albums; artist scans check every album and track listed in the discography.

**Can I run it on a schedule?**
Yes. Run it daily or weekly for your queries and get a steady stream of new pay-what-you-want releases. Scheduling is supported by Apify directly.

**How fresh is the data?**
Every result is read live from Bandcamp during the run.

**What if a release page is missing pricing info?**
Releases without digital pricing (physical-only or paywalled) are skipped, not guessed.

**I need more than 400 characters of release notes.**
The full text stays on Bandcamp; `about` gives you the first 400 characters to keep rows lean. Raise it for you if needed.

## Links

- Run it on the Apify Store: https://apify.com/red.cars/bandcamp-name-your-price-pro
- ScraperFleet page: https://scraperfleet.com/actors/bandcamp-name-your-price-pro/
