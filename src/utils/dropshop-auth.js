import axios from 'axios';
import { createModuleLogger } from './logger.js';
import config from '../config.js';

const log = createModuleLogger('dropshop-auth');

let cookieCache = null;
let cookieExpiry = 0;

export async function getDropShopAuthCookie() {
  if (cookieCache && Date.now() < cookieExpiry) {
    return cookieCache;
  }

  try {
    const username = process.env.DROPSHOP_USERNAME || 'gigglygadgets';
    const password = process.env.DROPSHOP_PASSWORD || 'Giggly@2024';

    log.info('Logging into DropShop to acquire session cookie...');
    const params = new URLSearchParams();
    params.append('log', username);
    params.append('pwd', password);
    params.append('wp-submit', 'Log In');
    params.append('redirect_to', 'https://dropshop.com.bd/');
    params.append('testcookie', '1');

    const res = await axios.post('https://dropshop.com.bd/wp-login.php', params, {
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const authCookie = cookies.map(c => c.split(';')[0]).join('; ');
      cookieCache = authCookie;
      // Cache for 12 hours
      cookieExpiry = Date.now() + 12 * 60 * 60 * 1000;
      log.info('Successfully acquired DropShop session cookie');
      return cookieCache;
    }
    
    log.warn('No cookies returned from DropShop login');
    return null;
  } catch (error) {
    log.error('Failed to log into DropShop', { error: error.message });
    return null;
  }
}
