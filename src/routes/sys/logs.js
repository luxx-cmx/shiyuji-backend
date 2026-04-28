import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/', requirePerm('log:view'), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, username, module, startDate, endDate } = req.query;
    const where = [];
    const values = [];
    if (username) { values.push(`%${username}%`); where.push(`username ILIKE $${values.length}`); }
    if (module) { values.push(`%${module}%`); where.push(`module ILIKE $${values.length}`); }
    if (startDate) { values.push(startDate); where.push(`created_at >= $${values.length}`); }
    if (endDate) { values.push(endDate); where.push(`created_at <= $${values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(pageSize);
    values.push(Number(pageSize)); const lIdx = values.length;
    values.push(offset); const oIdx = values.length;

    const list = await pool.query(
      `SELECT id, user_id, username, module, content, ip, created_at,
              (details IS NOT NULL) AS has_details
       FROM sys_operation_log ${whereSql}
       ORDER BY id DESC
       LIMIT $${lIdx} OFFSET $${oIdx}`,
      values
    );
    const total = await pool.query(
      `SELECT COUNT(1)::int AS total FROM sys_operation_log ${whereSql}`,
      values.slice(0, values.length - 2)
    );
    return res.json({ page: Number(page), pageSize: Number(pageSize), total: total.rows[0].total, data: list.rows });
  } catch (e) { return next(e); }
});

router.get('/:id', requirePerm('log:view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, username, module, content, details, ip, created_at
       FROM sys_operation_log
       WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: '日志不存在' });
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

export default router;
