import pino from 'pino';

// ─────────────────────────────────────────────────────────────────────────────
// Shared application logger (pino)
//
// In development:  pretty-printed, coloured output via pino-pretty transport.
// In production:   newline-delimited JSON — ready for log aggregators.
// ─────────────────────────────────────────────────────────────────────────────

const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
