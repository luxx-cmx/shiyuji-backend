import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAdminAuth);

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

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const offset = (Number(page) - 1) * Number(pageSize);
    values.push(Number(pageSize));
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const listSql = `
      SELECT u.id, u.username, u.nickname, u.avatar, u.height, u.age, u.target_weight,
             u.daily_target_calorie, u.status, u.created_at,
             COALESCE((pd.data->>'targetType'), '') AS target_type
      FROM users u
      LEFT JOIN profile_data pd ON pd.user_id = u.id::text
      ${whereClause}
      ORDER BY u.id DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const totalSql = `
      SELECT COUNT(1)::int AS total
      FROM users u
      LEFT JOIN profile_data pd ON pd.user_id = u.id::text
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

router.patch('/:id/status', async (req, res, next) => {
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
