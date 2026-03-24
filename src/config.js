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
      priceMarkup: 100, // Add BDT 100 to Suggested Price
    },
    gadgetTrack: {
      name: 'Gadget Track BD',
      baseUrl: 'https://www.gadgettrackbd.com',
      sitemaps: [
        'https://www.gadgettrackbd.com/product-sitemap.xml',
      ],
      priceMarkup: 0, // Use same price
    },
    executiveAmple: {
      name: 'Executive Ample',
      baseUrl: 'https://executiveample.com',
      sitemaps: [
        'https://executiveample.com/product-sitemap.xml',
      ],
      priceMarkup: 0,
    },
    gadgetBreeze: {
      name: 'Gadget Breeze',
      baseUrl: 'https://gadgetbreeze.com.bd',
      sitemaps: [
        'https://gadgetbreeze.com.bd/product-sitemap.xml',
      ],
      priceMarkup: 0,
    },
    accessoriesVandar: {
      name: 'Accessories Vandar',
      baseUrl: 'https://accessoriesvandar.com',
      sitemaps: [
        'https://accessoriesvandar.com/product-sitemap.xml',
      ],
      priceMarkup: 0,
    },
    gadgetZ: {
      name: 'GadgetZ',
      baseUrl: 'https://gadgetz.com.bd',
      sitemaps: [
        'https://gadgetz.com.bd/product-sitemap.xml',
      ],
      priceMarkup: 0,
    },
    famousGadget: {
      name: 'Famous Gadget',
      baseUrl: 'https://www.famousgadget.com.bd',
      sitemaps: [
        'https://www.famousgadget.com.bd/sitemap.xml',
      ],
      priceMarkup: 0,
    },
    rootGear: {
      name: 'RootGear BD',
      baseUrl: 'https://rootgearbd.com',
      sitemaps: [
        'https://rootgearbd.com/product-sitemap.xml',
      ],
      priceMarkup: 0,
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
    { pattern: /gadget\s*track\s*bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgettrackbd\.com/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgettrackbd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgettrack/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadget\s*track/gi, replacement: 'Giggly Gadgets' },
    { pattern: /executive\s*ample/gi, replacement: 'Giggly Gadgets' },
    { pattern: /executiveample\.com/gi, replacement: 'Giggly Gadgets' },
    { pattern: /executiveample/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadget\s*breeze/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgetbreeze\.com\.bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgetbreeze/gi, replacement: 'Giggly Gadgets' },
    { pattern: /accessories\s*vandar/gi, replacement: 'Giggly Gadgets' },
    { pattern: /accessoriesvandar\.com/gi, replacement: 'Giggly Gadgets' },
    { pattern: /accessoriesvandar/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgetz\.com\.bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /gadgetz/gi, replacement: 'Giggly Gadgets' },
    { pattern: /famous\s*gadget/gi, replacement: 'Giggly Gadgets' },
    { pattern: /famousgadget\.com\.bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /famousgadget/gi, replacement: 'Giggly Gadgets' },
    { pattern: /dropshop\.com\.bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /dropshop/gi, replacement: 'Giggly Gadgets' },
    { pattern: /drop\s*shop/gi, replacement: 'Giggly Gadgets' },
    { pattern: /rootgearbd\.com/gi, replacement: 'Giggly Gadgets' },
    { pattern: /rootgearbd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /root\s*gear\s*bd/gi, replacement: 'Giggly Gadgets' },
    { pattern: /root\s*gear/gi, replacement: 'Giggly Gadgets' },
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
