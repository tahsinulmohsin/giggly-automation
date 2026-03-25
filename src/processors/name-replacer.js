import config from '../config.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('name-replacer');

import * as cheerio from 'cheerio';

/**
 * Replace all source website names in text with "Giggly Gadgets".
 * Works safely on HTML by isolating text nodes and preserving attributes.
 * @param {string} text
 * @returns {string}
 */
export function replaceSourceNames(text) {
  if (!text) return text;

  // Simple check to determine if text is likely HTML
  const isHtml = /<[a-z][\s\S]*>/i.test(text);

  if (!isHtml) {
    let result = text;
    for (const { pattern, replacement } of config.nameReplacements) {
      const regex = new RegExp(pattern.source, pattern.flags);
      result = result.replace(regex, replacement);
    }
    return result;
  }

  const $ = cheerio.load(text, null, false); // false avoids injecting <html><body> tags

  // Find all text nodes and replace values
  $('*').contents().filter(function() {
    return this.type === 'text';
  }).each(function() {
    const parentTag = $(this).parent().get(0)?.tagName?.toLowerCase();
    if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript') {
      return; // Skip these raw data tags safely
    }

    let nodeText = $(this).text();
    for (const { pattern, replacement } of config.nameReplacements) {
      const regex = new RegExp(pattern.source, pattern.flags);
      nodeText = nodeText.replace(regex, replacement);
    }
    this.data = nodeText;
  });

  return $.html();
}

/**
 * Process a product object — replace source names in title, descriptions, etc.
 * @param {object} product
 * @returns {object}
 */
export function processProduct(product) {
  const processed = { ...product };

  processed.title = replaceSourceNames(processed.title);
  processed.description = replaceSourceNames(processed.description);
  processed.short_description = replaceSourceNames(processed.short_description);

  // Also clean up categories
  if (processed.categories) {
    processed.categories = processed.categories.map(cat => replaceSourceNames(cat));
  }

  // Clean up tags
  if (processed.tags) {
    processed.tags = processed.tags.map(tag => replaceSourceNames(tag));
  }

  // Clean up SEO fields
  processed.meta_title = replaceSourceNames(processed.meta_title);
  processed.meta_description = replaceSourceNames(processed.meta_description);

  log.debug(`Processed product: ${processed.title}`);
  return processed;
}
