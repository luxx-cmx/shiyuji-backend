import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAdminAuth);

async function getUsersNew(dimension = 'day') {
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

  return rows;
}

async function getUsersActive() {
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

  return rows[0];
}

async function getUsersTargets() {
  const { rows } = await pool.query(`
    SELECT COALESCE(pd.data->>'targetType', 'unknown') AS target_type,
           COUNT(1)::int AS count
    FROM users u
    LEFT JOIN profile_data pd ON pd.user_id = u.id::text
    GROUP BY target_type
    ORDER BY count DESC
  `);

  return rows;
}

async function getFoodsOverview() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(1)::int FROM foods) AS food_total,
      (SELECT COUNT(DISTINCT category)::int FROM foods) AS category_total,
      (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '1 day') AS food_new_1d,
      (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '7 days') AS food_new_7d,
      (SELECT COUNT(1)::int FROM foods WHERE created_at >= now() - interval '30 days') AS food_new_30d
  `);

  return rows[0];
}

async function getFoodsPopularFavorites() {
  const { rows } = await pool.query(`
    SELECT fav.name,
           COUNT(1)::int AS favorite_count,
           COALESCE(diet.entry_count, 0)::int AS record_count,
           COALESCE(food.category, '未知') AS category,
           food.calories
    FROM favorites fav
    LEFT JOIN LATERAL (
      SELECT COUNT(1)::int AS entry_count FROM diet_records d WHERE d.name = fav.name
    ) diet ON true
    LEFT JOIN LATERAL (
      SELECT category, calories FROM foods f WHERE f.name = fav.name LIMIT 1
    ) food ON true
    WHERE fav.name IS NOT NULL AND fav.name <> ''
    GROUP BY fav.name, diet.entry_count, food.category, food.calories
    ORDER BY favorite_count DESC, record_count DESC
    LIMIT 20
  `);

  return rows;
}

async function getFoodNutritionDistribution() {
  const { rows } = await pool.query(`
    SELECT 'calories' AS metric,
           CASE
             WHEN calories < 100 THEN '0-99'
             WHEN calories < 300 THEN '100-299'
             WHEN calories < 600 THEN '300-599'
             ELSE '600+'
           END AS bucket,
           COUNT(1)::int AS count
    FROM foods
    GROUP BY metric, bucket
    UNION ALL
    SELECT 'protein' AS metric,
           CASE
             WHEN COALESCE(protein, 0) < 5 THEN '0-4g'
             WHEN COALESCE(protein, 0) < 15 THEN '5-14g'
             WHEN COALESCE(protein, 0) < 30 THEN '15-29g'
             ELSE '30g+'
           END AS bucket,
           COUNT(1)::int AS count
    FROM foods
    GROUP BY metric, bucket
    UNION ALL
    SELECT 'fat' AS metric,
           CASE
             WHEN COALESCE(fat, 0) < 5 THEN '0-4g'
             WHEN COALESCE(fat, 0) < 15 THEN '5-14g'
             WHEN COALESCE(fat, 0) < 30 THEN '15-29g'
             ELSE '30g+'
           END AS bucket,
           COUNT(1)::int AS count
    FROM foods
    GROUP BY metric, bucket
    ORDER BY metric, bucket
  `);
  return rows;
}

async function getFoodCategories() {
  const { rows } = await pool.query(
    `SELECT category, COUNT(1)::int AS count
     FROM foods
     GROUP BY category
     ORDER BY count DESC, category ASC`
  );

  return rows;
}

async function getUserBehavior() {
  const [active, targetsResult, summaryResult] = await Promise.all([
    getUsersActive(),
    getUsersTargets(),
    pool.query(`
      SELECT
        (SELECT COUNT(1)::int FROM users) AS total_users,
        (SELECT COUNT(1)::int FROM users WHERE created_at >= date_trunc('day', now())) AS today_new_users,
        (SELECT COUNT(1)::int FROM diet_records WHERE created_at >= date_trunc('day', now())) AS today_diet_records,
        (SELECT COUNT(1)::int FROM weight_records WHERE created_at >= date_trunc('day', now())) AS today_weight_records,
        (SELECT COUNT(1)::int FROM exercise_records WHERE created_at >= date_trunc('day', now())) AS today_exercise_records
    `),
  ]);

  const summary = summaryResult.rows[0];
  const targetBreakdown = Object.fromEntries(targetsResult.map((item) => [item.target_type, item.count]));

  return {
    totalUsers: summary.total_users,
    todayNewUsers: summary.today_new_users,
    dau: active.dau,
    mau: active.mau,
    todayDietRecords: summary.today_diet_records,
    todayWeightRecords: summary.today_weight_records,
    todayExerciseRecords: summary.today_exercise_records,
    targetBreakdown,
  };
}

router.get('/users', async (req, res, next) => {
  try {
    const dimension = req.query.dimension || 'day';
    const [newUsers, active, targets] = await Promise.all([
      getUsersNew(dimension),
      getUsersActive(),
      getUsersTargets(),
    ]);

    return res.json({ dimension, newUsers, active, targets });
  } catch (error) {
    return next(error);
  }
});

router.get('/users/new', async (req, res, next) => {
  try {
    return res.json(await getUsersNew(req.query.dimension || 'day'));
  } catch (error) {
    return next(error);
  }
});

router.get('/users/active', async (req, res, next) => {
  try {
    return res.json(await getUsersActive());
  } catch (error) {
    return next(error);
  }
});

router.get('/users/targets', async (req, res, next) => {
  try {
    return res.json(await getUsersTargets());
  } catch (error) {
    return next(error);
  }
});

router.get('/foods', async (req, res, next) => {
  try {
    const [overview, popularFavorites] = await Promise.all([
      getFoodsOverview(),
      getFoodsPopularFavorites(),
    ]);

    return res.json({ overview, popularFavorites });
  } catch (error) {
    return next(error);
  }
});

router.get('/food-categories', async (req, res, next) => {
  try {
    return res.json(await getFoodCategories());
  } catch (error) {
    return next(error);
  }
});

router.get('/popular-favorites', async (req, res, next) => {
  try {
    const rows = await getFoodsPopularFavorites();
    return res.json(rows.map((row) => ({
      name: row.name,
      count: row.favorite_count,
      favoriteCount: row.favorite_count,
      recordCount: row.record_count,
      category: row.category,
      calories: row.calories,
    })));
  } catch (error) {
    return next(error);
  }
});

router.get('/foods/nutrition-distribution', async (req, res, next) => {
  try {
    return res.json(await getFoodNutritionDistribution());
  } catch (error) {
    return next(error);
  }
});

router.get('/user-behavior', async (req, res, next) => {
  try {
    return res.json(await getUserBehavior());
  } catch (error) {
    return next(error);
  }
});

router.get('/foods/overview', async (req, res, next) => {
  try {
    return res.json(await getFoodsOverview());
  } catch (error) {
    return next(error);
  }
});

router.get('/foods/popular-favorites', async (req, res, next) => {
  try {
    return res.json(await getFoodsPopularFavorites());
  } catch (error) {
    return next(error);
  }
});

export default router;
