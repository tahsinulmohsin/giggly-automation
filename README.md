# Giggly Gadgets Automation Pipeline 🚀

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)
![WooCommerce](https://img.shields.io/badge/WooCommerce-REST_API-purple.svg)

A fully automated backend system that monitors e-commerce source websites for new product listings, intelligently extracts and sanitizes SEO-rich product data (prices, variations, tags, images, meta parameters), and pushes the optimized products directly into the target [Giggly Shop](https://giggly.shop/) WooCommerce storefront.

## 📖 About
This system acts as an autonomous dropshipping and integration pipeline. It completely bypasses the need for heavy, error-prone browser automation (like Puppeteer/Playwright) by utilizing direct HTTP scraping and API communication.

**Key Features:**
- **Sitemap Monitoring:** Periodically scans source sitemaps to instantly detect newly added products.
- **Cheerio Extraction:** Lightning-fast HTML parsing to grab high-res images, categories, variant options, pricing logic, and stock status.
- **Deep Authentication:** Built to seamlessly fetch raw base prices without complex session integrations.
- **Intelligent Processing:** Automatically scrubs all mentions of competitor brands, replacing them with "Giggly Gadgets", and standardizes source pricing configurations 1:1.
- **SEO Preservation:** Captures WooCommerce tags, Yoast Meta Descriptions, and RankMath SEO Titles to preserve search rankings across the pipeline.
- **WooCommerce API Sync:** Sideloads images directly through URLs to save bandwidth, creates missing tags/categories on the fly, and manages duplicate-detection seamlessly.

---

## 🛠 Tech Stack
- **Node.js** (v20+)
- **Cheerio** (HTML parsing)
- **Axios** (HTTP & WordPress Authentication)
- **WooCommerce REST API** (`@woocommerce/woocommerce-rest-api`)
- **Better-SQLite3** (Lightweight database for tracking processed URLs across cycles)
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

### 4. Running the Pipeline
You can run the pipeline interactively from your terminal. When starting normally, the system will prompt you using an elegant CLI menu to select which specific website to process:
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
│  [2] Gadget Track BD                     │
│  [3] All Websites (Default)              │
└──────────────────────────────────────────┘
```

You can also run the pipeline in a variety of pre-configured modes depending on your testing needs (these bypass the CLI prompt):

- **Start Cron Service (Production):** `npm start`
  *(Runs the full pipeline based on your prompt selection, then sleeps and triggers itself globally every 30 minutes)*
- **Dry Run (Testing):** `npm run dry-run`
  *(Checks APIs, pulls product content, modifies parameters, and logs the result without writing anything to WooCommerce)*
- **Scrape Only:** `npm run scrape-only`
  *(Extracts listings into the local SQLite database without uploading)*
- **Test Single Upload:** `npm run test-upload`
  *(Forces a single item completely through the pipeline to verify WooCommerce credential validity)*
- **Sync Stock Constraints:** `npm run sync-stock`
  *(Validates stock statuses of old items)*

---

## 🚀 Deployment

### Option A: Local Windows / VPS (Recommended)
Because the pipeline uses a local disk-based SQLite database (`giggly.db`) to keep track of thousands of URL states, the most robust deployment method is simply keeping it running on your local Windows Server or a VPS (like DigitalOcean or Railway).
Use a process manager like PM2:
```bash
npm install pm2 -g
pm2 start src/index.js --name "giggly-pipeline"
```

### Option B: Vercel Serverless
*Note: Deploying to Vercel requires transitioning the SQLite local database into an external remote database (e.g., Supabase or Vercel Postgres) because Vercel's Edge architecture resets local files after every runtime execution.*

To deploy to Vercel currently, you must configure a Vercel Pipeline trigger to map `api/cron.js` into the Vercel infrastructure, and implement an external PostgreSQL database wrapper.

---

## 📦 Releases & Versioning
- **v1.1.0** — Replaced DropShop with Gadget Track BD to fetch exact matching pricing data. Implemented a dynamic terminal CLI menu to allow users to isolate scrapers to specific supplier domains interactively.
- **v1.0.0** — Initial Release. Supports native SEO/Tag translations, Dropshop & Gadget House synchronization.
