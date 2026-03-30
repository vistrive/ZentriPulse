import app from './app';
import { env } from './config/env';
import { pool } from './config/database';

async function start() {
  // Verify database connectivity
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  app.listen(env.port, () => {
    console.log(`ZentriPulse API running on port ${env.port} [${env.nodeEnv}]`);
    console.log(`Health check: http://localhost:${env.port}/health`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await pool.end();
  process.exit(0);
});

start();
