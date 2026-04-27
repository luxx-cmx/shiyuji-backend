import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAdminAuth);

async function getOverview() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(1)::int FROM users) AS user_total,
      (SELECT COUNT(1)::int FROM users WHERE status = 'active') AS user_active,
      (SELECT COUNT(1)::int FROM users WHERE created_at >= now() - interval '7 days') AS user_new_7d,
      (SELECT COUNT(1)::int FROM foods) AS food_total,
      (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '7 days') AS food_new_7d
  `);

  return rows[0];
}

async function getStats() {
  const { rows } = await pool.query(`
    WITH active_users AS (
      SELECT user_id FROM diet_records WHERE created_at >= now() - interval '30 days'
      UNION
      SELECT user_id FROM weight_records WHERE created_at >= now() - interval '30 days'
      UNION
      SELECT user_id FROM exercise_records WHERE created_at >= now() - interval '30 days'
    )
    SELECT
      (SELECT COUNT(1)::int FROM users) AS total_users,
      (SELECT COUNT(1)::int FROM users WHERE created_at >= date_trunc('day', now())) AS today_new_users,
      (SELECT COUNT(1)::int FROM foods) AS total_foods,
      (SELECT COUNT(1)::int FROM foods WHERE created_at >= date_trunc('day', now())) AS today_new_foods,
      (SELECT COUNT(1)::int FROM diet_records WHERE created_at >= date_trunc('day', now())) AS today_diet_records,
      (SELECT COUNT(1)::int FROM active_users) AS active_users
  `);

  return rows[0];
}

async function getAppUpdates() {
  const { rows } = await pool.query(`
    SELECT
      version,
      release_notes,
      COALESCE(to_char(release_date, 'YYYY-MM-DD'), to_char(update_time, 'YYYY-MM-DD')) AS release_date,
      COALESCE(force_update, false) AS force_update
    FROM app_update_record
    ORDER BY COALESCE(release_date::timestamp, update_time) DESC, id DESC
    LIMIT 20
  `);

  return rows;
}

router.get('/', async (req, res, next) => {
  try {
    return res.json(await getOverview());
  } catch (error) {
    return next(error);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    return res.json(await getOverview());
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getStats();
    return res.json({
      totalUsers: stats.total_users,
      todayNewUsers: stats.today_new_users,
      totalFoods: stats.total_foods,
      todayNewFoods: stats.today_new_foods,
      todayDietRecords: stats.today_diet_records,
      activeUsers: stats.active_users,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/app-updates', async (req, res, next) => {
  try {
    return res.json(await getAppUpdates());
  } catch (error) {
    return next(error);
  }
});

export default router;
