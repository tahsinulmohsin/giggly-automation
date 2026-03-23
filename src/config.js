import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const config = {
  // WooCommerce target store
  wc: {
    url: process.env.WC_URL || 'https://giggly.shop',
    consumerKey: process.env.WC_CONSUMER_KEY || '',
    consumerSecret: process.env.WC_CONSUMER_SECRET || '',
  },

  // Source websites
  sources: {
    gadgetHouse: {
      name: 'Gadget House BD',
      baseUrl: 'https://gadgethousesbd.com',
      sitemaps: [
        'https://gadgethousesbd.com/product-sitemap1.xml',
        'https://gadgethousesbd.com/product-sitemap2.xml',
        'https://gadgethousesbd.com/product-sitemap3.xml',
        'https://gadgethousesbd.com/product-sitemap4.xml',
      ],
      priceMarkup: 0, // Use same price
    },
    dropShop: {
      name: 'DropShop',
      baseUrl: 'https://dropshop.com.bd',
      sitemaps: [
        'https://dropshop.com.bd/wp-sitemap-posts-product-1.xml',
        'https://dropshop.com.bd/wp-sitemap-posts-product-2.xml',
      ],
      priceMarkup: 100, // Add BDT 100
    },
  },

  // Scraping settings
  scraping: {
    monitorIntervalMinutes: parseInt(process.env.MONITOR_INTERVAL_MINUTES || '30', 10),
    scrapeDelayMs: parseInt(process.env.SCRAPE_DELAY_MS || '2000', 10),
    maxImageConcurrency: parseInt(process.env.MAX_IMAGE_CONCURRENCY || '3', 10),
    requestTimeout: 15000,
    maxRetries: 3,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },

  // Name replacements — source names to strip from descriptions
  nameReplacements: [
    { pattern: /gadget\s*house\s*bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgethousesbd\.com/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgethousesbd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /dropshop\.com\.bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /dropshop/gi, replacement: 'Giggly Gadgets' },
    { pattern: /drop\s*shop/gi, replacement: 'Giggly Gadgets' },
  ],

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Paths
  paths: {
    downloads: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'downloads'),
    logs: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logs'),
    db: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'giggly.db'),
  },
};

export default config;
