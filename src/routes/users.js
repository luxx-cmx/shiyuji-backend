import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth, requirePerm } from '../middleware/auth.js';
import { hashPassword } from '../utils/password.js';
import { logAction } from '../utils/logger.js';

const router = Router();

router.use(requireAdminAuth);

const USER_LAYER_CASE = `
  CASE
    WHEN COALESCE(activity.activity_count, 0) >= 30 THEN 'high_value'
    WHEN activity.last_active_at >= now() - interval '7 days' THEN 'active'
    WHEN activity.last_active_at >= now() - interval '30 days' THEN 'sleeping'
    ELSE 'lost'
  END
`;

const USER_LAYER_LABEL_CASE = `
  CASE
    WHEN COALESCE(activity.activity_count, 0) >= 30 THEN '高价值'
    WHEN activity.last_active_at >= now() - interval '7 days' THEN '活跃'
    WHEN activity.last_active_at >= now() - interval '30 days' THEN '沉睡'
    ELSE '流失'
  END
`;

const USER_ACTIVITY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT MAX(t.created_at) AS last_active_at, COUNT(1)::int AS activity_count
    FROM (
      SELECT created_at FROM diet_records WHERE user_id = u.id::text
      UNION ALL SELECT created_at FROM weight_records WHERE user_id = u.id::text
      UNION ALL SELECT created_at FROM exercise_records WHERE user_id = u.id::text
    ) t
  ) activity ON true
`;

router.get('/', async (req, res, next) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      status,
      targetType,
      startDate,
      endDate,
      keyword,
      layer,
      lostOnly,
    } = req.query;

    const where = [];
    const values = [];

    if (status) {
      values.push(status);
      where.push(`u.status = $${values.length}`);
    }

    if (startDate) {
      values.push(startDate);
      where.push(`u.created_at >= $${values.length}`);
    }

    if (endDate) {
      values.push(endDate);
      where.push(`u.created_at <= $${values.length}`);
    }

    if (targetType) {
      values.push(targetType);
      where.push(`COALESCE(pd.data->>'targetType', '') = $${values.length}`);
    }

    if (keyword) {
      values.push(`%${keyword}%`);
      where.push(`(u.username ILIKE $${values.length} OR u.nickname ILIKE $${values.length})`);
    }

    if (layer) {
      values.push(layer);
      where.push(`${USER_LAYER_CASE} = $${values.length}`);
    }

    if (lostOnly === 'true') {
      where.push(`(${USER_LAYER_CASE}) = 'lost'`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const offset = (Number(page) - 1) * Number(pageSize);
    values.push(Number(pageSize));
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const listSql = `
      SELECT u.id, u.username, u.nickname, u.avatar, u.gender, u.height, u.age, u.target_weight,
             u.daily_target_calorie, u.status, u.created_at,
            COALESCE((pd.data->>'targetType'), '') AS target_type,
            activity.last_active_at,
            COALESCE(activity.activity_count, 0) AS activity_count,
            ${USER_LAYER_CASE} AS user_layer,
            ${USER_LAYER_LABEL_CASE} AS user_layer_label
      FROM users u
      LEFT JOIN profile_data pd ON pd.user_id = u.id::text
          ${USER_ACTIVITY_JOIN}
      ${whereClause}
      ORDER BY u.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const totalSql = `
      SELECT COUNT(1)::int AS total
      FROM users u
      LEFT JOIN profile_data pd ON pd.user_id = u.id::text
      ${USER_ACTIVITY_JOIN}
      ${whereClause}
    `;

    const [listResult, totalResult] = await Promise.all([
      pool.query(listSql, values),
      pool.query(totalSql, values.slice(0, values.length - 2)),
    ]);

    return res.json({
      page: Number(page),
      pageSize: Number(pageSize),
      total: totalResult.rows[0].total,
      data: listResult.rows,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/layers', requirePerm('user:layer', 'user:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT user_layer, user_layer_label, COUNT(1)::int AS count
      FROM (
        SELECT ${USER_LAYER_CASE} AS user_layer, ${USER_LAYER_LABEL_CASE} AS user_layer_label
        FROM users u
        ${USER_ACTIVITY_JOIN}
      ) t
      GROUP BY user_layer, user_layer_label
      ORDER BY count DESC
    `);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/loss-warning', requirePerm('user:loss', 'user:list'), async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.nickname, u.status, u.created_at, activity.last_active_at,
             COALESCE(activity.activity_count, 0) AS activity_count
      FROM users u
      ${USER_ACTIVITY_JOIN}
      WHERE ${USER_LAYER_CASE} = 'lost'
      ORDER BY activity.last_active_at NULLS FIRST, u.created_at ASC
      LIMIT $1
    `, [Number(limit)]);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/detail', requirePerm('user:detail', 'user:list'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const [userResult, goalsResult, dietResult, weightResult, exerciseResult, profileResult] = await Promise.all([
      pool.query(`
        SELECT u.id, u.username, u.nickname, u.avatar, u.height, u.age, u.gender, u.target_weight,
               u.daily_target_calorie, u.status, u.created_at, activity.last_active_at,
               COALESCE(activity.activity_count, 0) AS activity_count,
               ${USER_LAYER_CASE} AS user_layer,
               ${USER_LAYER_LABEL_CASE} AS user_layer_label
        FROM users u
        ${USER_ACTIVITY_JOIN}
        WHERE u.id = $1`, [id]),
      pool.query(`SELECT * FROM user_goals WHERE user_id = $1::bigint`, [id]).catch(() => ({ rows: [] })),
      pool.query(`SELECT COUNT(1)::int AS total_records, COALESCE(SUM(calories),0)::int AS total_calories FROM diet_records WHERE user_id = $1`, [String(id)]),
      pool.query(`SELECT weight, date, created_at FROM weight_records WHERE user_id = $1 ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 12`, [String(id)]),
      pool.query(`SELECT COUNT(1)::int AS total_records, COALESCE(SUM(calories),0)::int AS total_calories, COALESCE(SUM(duration),0)::int AS total_duration FROM exercise_records WHERE user_id = $1`, [String(id)]),
      pool.query(`SELECT data FROM profile_data WHERE user_id = $1`, [String(id)]).catch(() => ({ rows: [] })),
    ]);
    if (!userResult.rows[0]) return res.status(404).json({ message: '用户不存在' });
    return res.json({
      user: userResult.rows[0],
      goals: goalsResult.rows[0] || null,
      profile: profileResult.rows[0]?.data || {},
      dietStats: dietResult.rows[0] || {},
      exerciseStats: exerciseResult.rows[0] || {},
      weightTrend: weightResult.rows.reverse(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requirePerm('user:add'), async (req, res, next) => {
  try {
    const { username, password = '123456', nickname, gender, height, age, status = 'active' } = req.body || {};
    if (!username) return res.status(400).json({ message: 'username 必填' });
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, nickname, gender, height, age, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, username, nickname, gender, height, age, status, created_at`,
      [username, passwordHash, nickname || null, gender || null, height || null, age || null, status]
    );
    logAction(req, '用户管理', `新增用户：${username}`, { after: rows[0] });
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: '用户名已存在' });
    return next(error);
  }
});

router.put('/:id', requirePerm('user:edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nickname, gender, height, age, status } = req.body || {};
    const before = await pool.query(`SELECT id, username, nickname, gender, height, age, status FROM users WHERE id = $1`, [id]);
    const { rows, rowCount } = await pool.query(
      `UPDATE users SET
         nickname = COALESCE($1, nickname),
         gender = COALESCE($2, gender),
         height = COALESCE($3, height),
         age = COALESCE($4, age),
         status = COALESCE($5, status)
       WHERE id = $6
       RETURNING id, username, nickname, gender, height, age, status, created_at`,
      [nickname ?? null, gender ?? null, height ?? null, age ?? null, status ?? null, id]
    );
    if (!rowCount) return res.status(404).json({ message: '用户不存在' });
    logAction(req, '用户管理', `编辑用户：${rows[0].username}`, { before: before.rows[0] || null, after: rows[0] });
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requirePerm('user:delete'), async (req, res, next) => {
  try {
    const before = await pool.query(`SELECT id, username, nickname, status FROM users WHERE id = $1`, [req.params.id]);
    const result = await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: '用户不存在' });
    logAction(req, '用户管理', `删除用户 ID=${req.params.id}`, { before: before.rows[0] || null });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', requirePerm('user:edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ message: 'status 仅支持 active/disabled' });
    }

    const result = await pool.query(
      `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, status`,
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '用户不存在' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/export/csv', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, nickname, status, created_at
       FROM users
       ORDER BY id DESC
       LIMIT 10000`
    );

    const header = 'id,username,nickname,status,created_at';
    const lines = rows.map((r) =>
      [r.id, r.username, (r.nickname || '').replaceAll(',', '，'), r.status, r.created_at.toISOString()].join(',')
    );

    const csv = [header, ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');

    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    return next(error);
  }
});

export default router;
