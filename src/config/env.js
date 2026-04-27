import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
};

if (!env.databaseUrl) {
  throw new Error('DATABASE_URL 未配置');
}

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET 未配置');
}
