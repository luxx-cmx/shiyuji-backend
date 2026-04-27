import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/overview', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(1)::int FROM users) AS user_total,
        (SELECT COUNT(1)::int FROM users WHERE status = 'active') AS user_active,
        (SELECT COUNT(1)::int FROM users WHERE created_at >= now() - interval '7 days') AS user_new_7d,
        (SELECT COUNT(1)::int FROM foods) AS food_total,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '7 days') AS food_new_7d
    `);

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

export default router;
