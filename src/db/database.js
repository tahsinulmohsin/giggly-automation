import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('database');

let db;

/**
 * Initialize the SQLite database and create tables if needed.
 */
export function initDatabase() {
  const dbDir = path.dirname(config.paths.db);
  fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(config.paths.db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT UNIQUE NOT NULL,
      source_site TEXT NOT NULL,
      title TEXT,
      slug TEXT,
      regular_price REAL,
      sale_price REAL,
      final_price REAL,
      description TEXT,
      short_description TEXT,
      categories TEXT,
      images TEXT,
      variations TEXT,
      stock_status TEXT DEFAULT 'instock',
      wc_product_id INTEGER,
      status TEXT DEFAULT 'pending',
      scraped_at TEXT,
      uploaded_at TEXT,
      last_synced_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sitemap_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      source_site TEXT NOT NULL,
      discovered_at TEXT DEFAULT (datetime('now')),
      processed INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_products_source_url ON products(source_url);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_products_wc_id ON products(wc_product_id);
    CREATE INDEX IF NOT EXISTS idx_sitemap_processed ON sitemap_urls(processed);
  `);

  // Migrations for schema additions
  try { db.exec("ALTER TABLE products ADD COLUMN tags TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN meta_title TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE products ADD COLUMN meta_description TEXT"); } catch(e) {}

  log.info('Database initialized', { path: config.paths.db });
  return db;
}

/**
 * Get the database instance.
 */
export function getDb() {
  if (!db) initDatabase();
  return db;
}

// ── Sitemap URL operations ──

export function addSitemapUrl(url, sourceSite) {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO sitemap_urls (url, source_site) VALUES (?, ?)'
  );
  return stmt.run(url, sourceSite);
}

export function getUnprocessedUrls(limit = 50, targetSource = null) {
  if (targetSource && targetSource !== 'all') {
    return getDb().prepare(
      'SELECT * FROM sitemap_urls WHERE processed = 0 AND source_site = ? ORDER BY discovered_at ASC LIMIT ?'
    ).all(targetSource, limit);
  }
  return getDb().prepare(
    'SELECT * FROM sitemap_urls WHERE processed = 0 ORDER BY discovered_at ASC LIMIT ?'
  ).all(limit);
}

export function markUrlProcessed(url) {
  getDb().prepare(
    'UPDATE sitemap_urls SET processed = 1 WHERE url = ?'
  ).run(url);
}

export function isUrlKnown(url) {
  const row = getDb().prepare(
    'SELECT 1 FROM sitemap_urls WHERE url = ?'
  ).get(url);
  return !!row;
}

/**
 * Reset orphaned URLs — URLs marked as processed but with no corresponding
 * product in the products table (e.g. because the product was deleted).
 * This prevents the recurring "0 unprocessed URLs" cache lock issue.
 * @param {string|null} targetSource - Specific source to reset, or null for all
 * @returns {number} Number of URLs reset
 */
export function resetOrphanedUrls(targetSource = null) {
  let stmt;
  if (targetSource && targetSource !== 'all') {
    stmt = getDb().prepare(`
      UPDATE sitemap_urls SET processed = 0
      WHERE processed = 1
        AND source_site = ?
        AND url NOT IN (SELECT source_url FROM products)
    `);
    return stmt.run(targetSource).changes;
  }
  stmt = getDb().prepare(`
    UPDATE sitemap_urls SET processed = 0
    WHERE processed = 1
      AND url NOT IN (SELECT source_url FROM products)
  `);
  return stmt.run().changes;
}

// ── Product operations ──

export function upsertProduct(product) {
  const existing = getDb().prepare('SELECT id FROM products WHERE source_url = ?').get(product.source_url);

  if (existing) {
    const stmt = getDb().prepare(`
      UPDATE products SET
        title = ?, slug = ?, regular_price = ?, sale_price = ?, final_price = ?,
        description = ?, short_description = ?, categories = ?, images = ?,
        variations = ?, stock_status = ?, status = ?,
        tags = ?, meta_title = ?, meta_description = ?,
        scraped_at = datetime('now'), updated_at = datetime('now'),
        error_message = NULL
      WHERE source_url = ?
    `);
    stmt.run(
      product.title, product.slug, product.regular_price, product.sale_price,
      product.final_price, product.description, product.short_description,
      JSON.stringify(product.categories || []), JSON.stringify(product.images || []),
      JSON.stringify(product.variations || []), product.stock_status || 'instock',
      'scraped', 
      JSON.stringify(product.tags || []), product.meta_title || '', product.meta_description || '',
      product.source_url
    );
    return existing.id;
  } else {
    const stmt = getDb().prepare(`
      INSERT INTO products (
        source_url, source_site, title, slug, regular_price, sale_price, final_price,
        description, short_description, categories, images, variations,
        stock_status, status, scraped_at, tags, meta_title, meta_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scraped', datetime('now'), ?, ?, ?)
    `);
    const result = stmt.run(
      product.source_url, product.source_site, product.title, product.slug,
      product.regular_price, product.sale_price, product.final_price,
      product.description, product.short_description,
      JSON.stringify(product.categories || []), JSON.stringify(product.images || []),
      JSON.stringify(product.variations || []), product.stock_status || 'instock',
      JSON.stringify(product.tags || []), product.meta_title || '', product.meta_description || ''
    );
    return result.lastInsertRowid;
  }
}

export function getProductsToUpload(limit = 20, targetSource = null) {
  if (targetSource && targetSource !== 'all') {
    return getDb().prepare(
      "SELECT * FROM products WHERE status = 'scraped' AND source_site = ? ORDER BY scraped_at ASC LIMIT ?"
    ).all(targetSource, limit);
  }
  return getDb().prepare(
    "SELECT * FROM products WHERE status = 'scraped' ORDER BY scraped_at ASC LIMIT ?"
  ).all(limit);
}

export function markProductUploaded(sourceUrl, wcProductId) {
  getDb().prepare(`
    UPDATE products SET
      wc_product_id = ?, status = 'uploaded',
      uploaded_at = datetime('now'), updated_at = datetime('now')
    WHERE source_url = ?
  `).run(wcProductId, sourceUrl);
}

export function markProductError(sourceUrl, errorMessage) {
  getDb().prepare(`
    UPDATE products SET
      status = 'error', error_message = ?,
      updated_at = datetime('now')
    WHERE source_url = ?
  `).run(errorMessage, sourceUrl);
}

export function getUploadedProducts() {
  return getDb().prepare(
    "SELECT * FROM products WHERE status = 'uploaded' AND wc_product_id IS NOT NULL"
  ).all();
}

export function updateStockStatus(sourceUrl, stockStatus) {
  getDb().prepare(`
    UPDATE products SET
      stock_status = ?, last_synced_at = datetime('now'),
      updated_at = datetime('now')
    WHERE source_url = ?
  `).run(stockStatus, sourceUrl);
}

export function getStats() {
  const db = getDb();
  return {
    totalUrls: db.prepare('SELECT COUNT(*) as c FROM sitemap_urls').get().c,
    unprocessedUrls: db.prepare('SELECT COUNT(*) as c FROM sitemap_urls WHERE processed = 0').get().c,
    totalProducts: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
    scraped: db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'scraped'").get().c,
    uploaded: db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'uploaded'").get().c,
    errors: db.prepare("SELECT COUNT(*) as c FROM products WHERE status = 'error'").get().c,
  };
}
