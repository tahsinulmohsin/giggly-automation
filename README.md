# Giggly Gadgets Automation Pipeline 🚀

![Version](https://img.shields.io/badge/version-2.1.2-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)
![WooCommerce](https://img.shields.io/badge/WooCommerce-REST_API-purple.svg)

A fully automated backend system that monitors 8 distinct e-commerce source websites for new product listings, intelligently extracts and sanitizes SEO-rich product data (prices, variations, tags, images, meta parameters), and pushes the optimized products directly into the target [Giggly Shop](https://giggly.shop/) WooCommerce storefront.

## 📖 About
This system acts as an autonomous dropshipping and integration pipeline. It completely bypasses the need for heavy, error-prone browser automation (like Puppeteer/Playwright) by utilizing direct HTTP scraping and API communication.

**Key Features:**
- **Universal Multi-Source Engine:** Effortlessly monitors 8 leading platforms natively (Gadget House BD, DropShop, Gadget Track BD, Executive Ample, Gadget Breeze, Accessories Vandar, GadgetZ, Famous Gadget).
- **Smart Merge Deduplication:** If multiple suppliers offer the exact same product, the system automatically detects the duplicate and intelligently overwrites your current WooCommerce listing *only if* the new scraper discovers a cheaper price.
- **DropShop Margin Injection:** Unique authenticated logic that natively bypasses DropShop's login gates, extracts the raw "Suggested Price," and dynamically forces an automated `+100 BDT` profit margin.
- **Sitemap Monitoring & Cheerio:** Lightning-fast HTML parsing (compatible with both standard WooCommerce and Custom CommerceKit themes) to grab high-res images, categories, variant options, and stock statuses.
- **Intelligent Name Scrubbing:** Automatically scrubs all proprietary mentions of the 8 competitor brands, replacing them seamlessly with "Giggly Gadgets".
- **SEO Preservation:** Captures WooCommerce tags, Yoast Meta Descriptions, and RankMath SEO Titles to preserve search rankings across the pipeline.

---

## 🛠 Tech Stack
- **Node.js** (v20+)
- **Cheerio** (HTML multi-theme parsing)
- **Axios** (HTTP & WordPress Authentication)
- **WooCommerce REST API** (`@woocommerce/woocommerce-rest-api`)
- **Better-SQLite3** (Lightweight scalable database for deduplication)
- **Node-Cron** (Periodic scheduling)
- **Winston** (Module-level rotating file logs)

---

## ⚙️ Local Development & Setup

### 1. Prerequisites
Ensure you have Node.js v20 or later installed on your machine.

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/gigglygadgets/giggly-automation.git
cd giggly-automation
npm install
```

### 3. Environment Configuration
Copy the sample environment file to `.env`:
```bash
cp .env.example .env
```
Fill out the variables in `.env`:
- `WC_URL`: `https://giggly.shop`
- `WC_CONSUMER_KEY`: Your generated WooCommerce API Key
- `WC_CONSUMER_SECRET`: Your generated WooCommerce API Secret
- `DROPSHOP_USERNAME` & `DROPSHOP_PASSWORD`: (For active DropShop BDT +100 Margin injection)

### 4. Running the Pipeline
You can run the pipeline interactively from your terminal. When starting normally, the system will prompt you using an elegant, dynamic CLI menu to precisely target your data flow:
```bash
npm start
```

*Example Output:*
```text
┌──────────────────────────────────────────┐
│  Giggly Gadgets Product Automation       │
├──────────────────────────────────────────┤
│  Select target website to process:       │
│                                          │
│  [1] Gadget House BD                     │
│  [2] DropShop                            │
│  [3] Gadget Track BD                     │
│  [4] Executive Ample                     │
│  [5] Gadget Breeze                       │
│  [6] Accessories Vandar                  │
│  [7] GadgetZ                             │
│  [8] Famous Gadget                       │
│  [9] All Websites (Default)              │
└──────────────────────────────────────────┘
```

You can also run the pipeline in a variety of pre-configured modes depending on your testing needs (these bypass the CLI prompt):

- **Start Cron Service (Production):** `npm start`
- **Dry Run (Testing):** `npm run dry-run`
- **Scrape Only:** `npm run scrape-only`
- **Test Single Upload:** `npm run test-upload`
- **Sync Stock:** `npm run sync-stock`

### 🔄 Stock Synchronization

Run `npm run sync-stock` to automatically check the stock status of **every uploaded product** against its original source website. The system will:

1. Pull up all products in the database that have been uploaded to giggly.shop
2. Visit each product's original supplier URL (DropShop, Gadget Breeze, Gadget House, etc.)
3. Check whether the product is currently **In Stock** or **Out of Stock** on the supplier's site
4. If the status has changed, update the giggly.shop product via the WooCommerce REST API

> **Note:** With ~3,000+ uploaded products, this process can take **1.5–2 hours** depending on your `SCRAPE_DELAY_MS` setting (default: 2 seconds per product). You can lower the delay in your `.env` file to speed it up, but be cautious of rate limiting from supplier websites.

---

## 📦 Releases & Versioning
- **v2.1.2 (Dynamic Stock & Price Sync)** — Upgraded the `npm run sync-stock` routine to natively track and mirror price fluctuations. Whenever the pipeline verifies product stock against the origin source, it also dynamically compares the database price to the scraped price. If the supplier changes their pricing (higher or lower), the automation accurately patches the WooCommerce product payload with the new `regular_price` and `sale_price` directly via the API.
- **v2.1.1 (RootGear Integration)** — Added the 9th supplier, RootGear, to the scraping pipeline. Since they do not expose a comprehensive product sitemap, built a custom paginated shop crawler to physically walk their catalog, discovering and extracting prices, stock levels, and variants with identical giggly pipeline mechanics.
- **v2.1.0 (SEO Title Suffix Stripper)** — Fixed a critical share-preview bug where the WooCommerce Yoast SEO plugin appended "Giggly Gadgets 2.5 | Dropshipping Platform" on top of the already-appended supplier site name (e.g., "Product - DropShop"). Implemented `cleanMetaTitle` to permanently strip supplier suffixes from origin metadata before Woo upload. retroactively scrubbed ~2,900 existing products via WooCommerce Batch API.
- **v2.0.9 (DropShop Full Catalog Crawler)** — WordPress default sitemaps cap at 2,000 URLs per page. DropShop has ~3,847 products, leaving ~1,847 completely invisible to the scraper. Built a paginated `/shop/` page crawler that walks all 128+ shop pages to discover every product URL. Automatically runs after the normal sitemap scan when DropShop is targeted. First run discovered and queued 1,847 new products.
- **v2.0.8 (Self-Healing Scraper Queue)** — Permanently eliminated the recurring "0 unprocessed URLs" cache lock by implementing automatic orphan detection. The pipeline now self-heals on every cycle by detecting sitemap URLs marked as processed but with no corresponding product record, and automatically re-queues them.
- **v2.0.7 (Uploader Stability Patch)** — Fortified the WooCommerce uploader payload generator against `400 Bad Request` crashes caused by malformed/empty image URLs from source websites. Added strict `http` prefix validation on all image arrays. Doubled the HTTP request timeout from 15s to 30s to prevent Executive Ample sitemap timeouts. Removed deprecated DropShop sitemap page 2.
- **v2.0.6 (CDATA Link Corruption Fix)** — Fixed a critical vulnerability where Cheerio misclassified the inner DOM of `<noscript>`, `<style>`, and `<script>` elements as raw text nodes, exposing origin attributes to the name-scrubbing regex and generating corrupted `giggly gadgets` URLs. Added routines to delete `<noscript>` artifacts entirely, preventing lazy-load duplicates.
- **v2.0.5 (Hotlink Media Sideload Engine)** — Decoupled the pipeline's image requirements from origin servers to enforce local storage autonomy. Constructed a revolutionary bypass algorithm that temporarily mounts a `Draft` WooCommerce Proxy Product, feeds it the scraped HTML origin graphic URLs, hijacks the WooCommerce media library's download protocols securely without native WP Admin permissions, shreds the proxy, and natively remaps the `giggly.shop` output URLs back into the active description array in real-time.
- **v2.0.4 (Image Sanitizer Patch)** — Implemented a universal `cleanDescriptionHtml` sanitizer to permanently eliminate broken images caused by LiteSpeed and WP-Rocket lazy-loading plugins (e.g., Gadget Breeze). The extraction engine now systematically reconstructs actual URLs hidden inside `data-lazy-src` nodes and rewrites relative web paths to absolute source hostnames, destroying the blank `data:image/svg+xml` placeholders that caused Giggly Shop hotlink failures.
- **v2.0.3 (Critical Structural Patch)** — Permanently removed the greedy `.entry-content` CSS fallback from all 4 Universal Scraper engines. If a product natively lacked a description tab, the scraper incorrectly dumped the entire Elementor webpage body (often 100KB+ of layout code) into the WooCommerce API. The pipeline now correctly returns an empty description to rely on the short-description field instead.
- **v2.0.2 (Critical Fix)** — Resolved broken product descriptions for Executive Ample (and all Elementor-based sources) by converting greedy DOM selectors to a cascading waterfall. Rewrote the Name Replacer to use Cheerio text-node parsing, preventing `src`/`href` attribute corruption that was producing broken image links on giggly.shop. Description payload reduced from ~117K to ~8K chars.
- **v2.0.1 (Hotfix)** — Patched a routing anomaly where the CLI interactive menu dropped `targetSource` parameters during database polling algorithms, restoring completely isolated multi-source scraper arrays.
- **v2.0.0** — Massive scalable expansion to 8 integrated eCommerce sources utilizing a Universal Scraper architecture. Restored active DropShop credentials with precise +100 BDT markup logic. Introduced Lowest-Price Smart Merging for automated deduplication across overlapping suppliers. Hardened CSS extractors against live CommerceKit framework shifts.
- **v1.1.0** — Replaced DropShop with Gadget Track BD to fetch exact matching pricing data. Implemented a dynamic terminal CLI menu to allow users to isolate scrapers to specific supplier domains interactively.
- **v1.0.0** — Initial Release. Supports native SEO/Tag translations, Dropshop & Gadget House synchronization.
