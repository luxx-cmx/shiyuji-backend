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

function percentChange(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return c === 0 ? 0 : 100;
  return Number((((c - p) / p) * 100).toFixed(2));
}

async function getDashboardTrends(range = 'day') {
  const bucketExpr = range === 'month'
    ? `to_char(d.day, 'YYYY-MM')`
    : range === 'week'
      ? `to_char(date_trunc('week', d.day), 'IYYY-IW')`
      : `to_char(d.day, 'YYYY-MM-DD')`;

  const { rows } = await pool.query(`
    WITH days AS (
      SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS day
    ), user_daily AS (
      SELECT created_at::date AS day, COUNT(1)::int AS count FROM users
      WHERE created_at >= current_date - interval '29 days'
      GROUP BY created_at::date
    ), food_daily AS (
      SELECT created_at::date AS day, COUNT(1)::int AS count FROM foods
      WHERE created_at >= current_date - interval '29 days'
      GROUP BY created_at::date
    )
    SELECT ${bucketExpr} AS bucket,
           SUM(COALESCE(u.count, 0))::int AS new_users,
           SUM(COALESCE(f.count, 0))::int AS new_foods
    FROM days d
    LEFT JOIN user_daily u ON u.day = d.day
    LEFT JOIN food_daily f ON f.day = d.day
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return { range, data: rows };
}

async function getDashboardOperations() {
  const { rows } = await pool.query(`
    WITH base AS (
      SELECT
        (SELECT COUNT(1)::int FROM users WHERE created_at >= current_date) AS today_users,
        (SELECT COUNT(1)::int FROM users WHERE created_at >= current_date - interval '1 day' AND created_at < current_date) AS yesterday_users,
        (SELECT COUNT(1)::int FROM users WHERE created_at >= current_date - interval '7 days') AS users_7d,
        (SELECT COUNT(1)::int FROM users WHERE created_at >= current_date - interval '14 days' AND created_at < current_date - interval '7 days') AS users_prev_7d,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= current_date) AS today_foods,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= current_date - interval '1 day' AND created_at < current_date) AS yesterday_foods,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= current_date - interval '7 days') AS foods_7d,
        (SELECT COUNT(1)::int FROM foods WHERE created_at >= current_date - interval '14 days' AND created_at < current_date - interval '7 days') AS foods_prev_7d,
        (SELECT COUNT(1)::int FROM users u WHERE NOT EXISTS (
          SELECT 1 FROM diet_records d WHERE d.user_id = u.id::text AND d.created_at >= now() - interval '30 days'
          UNION
          SELECT 1 FROM weight_records w WHERE w.user_id = u.id::text AND w.created_at >= now() - interval '30 days'
          UNION
          SELECT 1 FROM exercise_records e WHERE e.user_id = u.id::text AND e.created_at >= now() - interval '30 days'
        )) AS inactive_30d,
        (SELECT COUNT(1)::int FROM users) AS total_users
    ) SELECT * FROM base
  `);
  const b = rows[0] || {};
  const inactiveRate = Number(b.total_users || 0) ? Number(((Number(b.inactive_30d || 0) / Number(b.total_users || 1)) * 100).toFixed(2)) : 0;
  const warnings = [];
  if (Number(b.today_users || 0) === 0) warnings.push({ level: 'danger', title: '今日新增用户为 0', message: '建议检查投放、注册链路或活动入口。' });
  if (Number(b.today_foods || 0) < Math.max(1, Number(b.yesterday_foods || 0) * 0.5)) warnings.push({ level: 'warning', title: '今日新增食物明显下降', message: `昨日 ${b.yesterday_foods || 0}，今日 ${b.today_foods || 0}。` });
  if (inactiveRate >= 30) warnings.push({ level: 'danger', title: '用户流失率偏高', message: `30 天无行为用户占比 ${inactiveRate}%。` });

  return {
    metrics: {
      todayUsers: { value: b.today_users, dayRatio: percentChange(b.today_users, b.yesterday_users), weekRatio: percentChange(b.users_7d, b.users_prev_7d) },
      todayFoods: { value: b.today_foods, dayRatio: percentChange(b.today_foods, b.yesterday_foods), weekRatio: percentChange(b.foods_7d, b.foods_prev_7d) },
      inactiveRate: { value: inactiveRate, inactiveUsers: b.inactive_30d, totalUsers: b.total_users },
    },
    warnings,
  };
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

router.get('/trends', async (req, res, next) => {
  try {
    return res.json(await getDashboardTrends(req.query.range || 'day'));
  } catch (error) {
    return next(error);
  }
});

router.get('/operations', async (req, res, next) => {
  try {
    return res.json(await getDashboardOperations());
  } catch (error) {
    return next(error);
  }
});

export default router;
