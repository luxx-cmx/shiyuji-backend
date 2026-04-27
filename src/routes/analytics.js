import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/users/new', async (req, res, next) => {
  try {
    const { dimension = 'day' } = req.query;
    const dateExpr =
      dimension === 'month'
        ? `to_char(created_at, 'YYYY-MM')`
        : dimension === 'week'
          ? `to_char(date_trunc('week', created_at), 'IYYY-IW')`
          : `to_char(created_at, 'YYYY-MM-DD')`;

    const { rows } = await pool.query(
      `SELECT ${dateExpr} AS bucket, COUNT(1)::int AS count
       FROM users
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT 180`
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/users/active', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      WITH active_users AS (
        SELECT user_id FROM diet_records WHERE created_at >= now() - interval '30 days'
        UNION
        SELECT user_id FROM weight_records WHERE created_at >= now() - interval '30 days'
        UNION
        SELECT user_id FROM exercise_records WHERE created_at >= now() - interval '30 days'
      )
      SELECT
        (SELECT COUNT(1)::int FROM active_users) AS mau,
        (SELECT COUNT(1)::int FROM (
          SELECT user_id FROM diet_records WHERE created_at >= now() - interval '1 day'
          UNION
          SELECT user_id FROM weight_records WHERE created_at >= now() - interval '1 day'
          UNION
          SELECT user_id FROM exercise_records WHERE created_at >= now() - interval '1 day'
        ) t) AS dau
    `);

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/users/targets', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT COALESCE(pd.data->>'targetType', 'unknown') AS target_type,
             COUNT(1)::int AS count
      FROM users u
      LEFT JOIN profile_data pd ON pd.user_id = u.id::text
      GROUP BY target_type
      ORDER BY count DESC
    `);

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/foods/overview', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(1)::int FROM foods) AS food_total,
        (SELECT COUNT(DISTINCT category)::int FROM foods) AS category_total,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '1 day') AS food_new_1d,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '7 days') AS food_new_7d,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '30 days') AS food_new_30d
    `);

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/foods/popular-favorites', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT fav.name, COUNT(1)::int AS favorite_count
      FROM favorites fav
      WHERE fav.name IS NOT NULL AND fav.name <> ''
      GROUP BY fav.name
      ORDER BY favorite_count DESC
      LIMIT 20
    `);

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

export default router;
