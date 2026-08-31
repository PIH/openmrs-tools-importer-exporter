// logger.js
import { createLogger, format, transports } from 'winston';
import path from 'path';
import config from './config.js';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(config.LOG_HOME, 'app.log') })
  ]
});

export const invalidIdentifierLogger = createLogger({
  level: 'info',
  format: format.printf(({ message }) => message),
  transports: [
    new transports.File({ filename: path.join(config.LOG_HOME, 'invalid-identifiers.log') })
  ]
});

export default logger;