import dotenv from 'dotenv';
dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://zentripulse:zentripulse@localhost:5432/zentripulse',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  assetZentriBaseUrl: process.env.ASSETZENTRI_BASE_URL || '',
  assetZentriApiKey: process.env.ASSETZENTRI_API_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'debug',
} as const;
