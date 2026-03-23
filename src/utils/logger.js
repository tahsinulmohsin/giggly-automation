import winston from 'winston';
import path from 'path';
import fs from 'fs';
import config from '../config.js';

// Ensure logs directory exists
fs.mkdirSync(config.paths.logs, { recursive: true });

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'giggly-automation' },
  transports: [
    // Console — colorized, human-readable
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
          const mod = module ? `[${module}]` : '';
          const extra = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${level} ${mod} ${message}${extra}`;
        })
      ),
    }),
    // File — all logs
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'automation.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // File — errors only
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

/**
 * Create a child logger with a module name tag.
 * @param {string} moduleName
 */
export function createModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}

export default logger;
