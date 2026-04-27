import { pool } from './pool.js';
import { seedFoodData } from './foodSeedData.js';

export async function seedFoods() {
  const check = await pool.query('SELECT COUNT(1)::int AS count FROM foods');
  if (check.rows[0].count > 0) {
    return { inserted: 0, skipped: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of seedFoodData) {
      await client.query(
        `INSERT INTO foods (name, category, calories)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [item.name, item.category, item.calories]
      );
    }
    await client.query('COMMIT');
    return { inserted: seedFoodData.length, skipped: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
