import 'dotenv/config';
import app from './app';
import redisService from './services/redis.service';

const PORT: number = parseInt(process.env.PORT ?? '5000', 10);
const NODE_ENV: string = process.env.NODE_ENV ?? 'development';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  // Connect to Redis before accepting traffic
  await redisService.connect();

  const server = app.listen(PORT, () => {
    console.log('─────────────────────────────────────────');
    console.log(`  🚀  OmniFlow Backend`);
    console.log(`  ⚡  Env   : ${NODE_ENV}`);
    console.log(`  🌐  URL   : http://localhost:${PORT}`);
    console.log(`  ✅  Health: http://localhost:${PORT}/api/v1/health`);
    console.log('─────────────────────────────────────────');
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully…`);
    server.close(async () => {
      console.log('[Server] HTTP server closed.');
      await redisService.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});

