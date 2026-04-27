import app from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { ensureSchema } from './db/schema.js';
import { seedFoods } from './db/seedFoods.js';

async function bootstrap() {
  try {
    await pool.query('SELECT 1');
    await ensureSchema();
    const seedResult = await seedFoods();

    app.listen(env.port, () => {
      console.log(`✅ 服务已启动: http://localhost:${env.port}`);
      console.log(`✅ 数据库初始化完成，foods seeded: ${seedResult.inserted}, skipped: ${seedResult.skipped}`);
      console.log('✅ 默认管理员: admin / Admin@123456（可通过 ADMIN_USERNAME/ADMIN_PASSWORD 覆盖）');
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

bootstrap();
