import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';
import { hashPassword } from '../../utils/password.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/', requirePerm('permission:view', 'role:list'), async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword, status } = req.query;
    const where = [];
    const values = [];
    if (keyword) {
      values.push(`%${keyword}%`);
      where.push(`(u.username ILIKE $${values.length} OR u.nickname ILIKE $${values.length})`);
    }
    if (status) { values.push(status); where.push(`u.status = $${values.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(pageSize);
    values.push(Number(pageSize)); const lIdx = values.length;
    values.push(offset); const oIdx = values.length;

    const list = await pool.query(
      `SELECT u.id, u.username, u.nickname, u.phone, u.email, u.status, u.dept_id,
              d.dept_name, u.last_login_at, u.created_at,
              COALESCE(array_agg(r.role_code) FILTER (WHERE r.id IS NOT NULL), '{}') AS role_codes,
              COALESCE(array_agg(r.role_name) FILTER (WHERE r.id IS NOT NULL), '{}') AS role_names
       FROM sys_user u
       LEFT JOIN sys_dept d ON d.id = u.dept_id
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
       ${whereSql}
       GROUP BY u.id, d.dept_name
       ORDER BY u.id DESC
       LIMIT $${lIdx} OFFSET $${oIdx}`,
      values
    );
    const total = await pool.query(
      `SELECT COUNT(1)::int AS total FROM sys_user u ${whereSql}`,
      values.slice(0, values.length - 2)
    );
    return res.json({ page: Number(page), pageSize: Number(pageSize), total: total.rows[0].total, data: list.rows });
  } catch (e) { return next(e); }
});

router.post('/', requirePerm('role:list', 'permission:view'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { username, password, nickname, phone, email, dept_id, status = 'enable', roleIds = [] } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: '用户名与密码必填' });
    const hash = await hashPassword(password);

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO sys_user (username, password_hash, nickname, phone, email, dept_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username, nickname, status`,
      [username, hash, nickname || null, phone || null, email || null, dept_id || null, status]
    );
    const userId = ins.rows[0].id;
    for (const rid of roleIds) {
      await client.query(`INSERT INTO sys_user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, rid]);
    }
    await client.query('COMMIT');
    logAction(req, '后台账号', `新增账号：${username}`);
    return res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ message: '用户名已存在' });
    return next(e);
  } finally { client.release(); }
});

router.put('/:id', requirePerm('role:list', 'permission:view'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { nickname, phone, email, dept_id, status, password, roleIds } = req.body || {};
    await client.query('BEGIN');
    if (password) {
      const hash = await hashPassword(password);
      await client.query(`UPDATE sys_user SET password_hash = $1 WHERE id = $2`, [hash, req.params.id]);
    }
    const r = await client.query(
      `UPDATE sys_user SET
         nickname = COALESCE($1, nickname),
         phone = COALESCE($2, phone),
         email = COALESCE($3, email),
         dept_id = COALESCE($4, dept_id),
         status = COALESCE($5, status)
       WHERE id = $6 RETURNING id, username, status`,
      [nickname ?? null, phone ?? null, email ?? null, dept_id ?? null, status ?? null, req.params.id]
    );
    if (!r.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ message: '用户不存在' }); }
    if (Array.isArray(roleIds)) {
      await client.query(`DELETE FROM sys_user_role WHERE user_id = $1`, [req.params.id]);
      for (const rid of roleIds) {
        await client.query(`INSERT INTO sys_user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, rid]);
      }
    }
    await client.query('COMMIT');
    logAction(req, '后台账号', `编辑账号：${r.rows[0].username}`);
    return res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally { client.release(); }
});

router.delete('/:id', requirePerm('role:list', 'permission:view'), async (req, res, next) => {
  try {
    if (Number(req.params.id) === Number(req.admin.sub) && req.admin.source === 'sys_user') {
      return res.status(400).json({ message: '不能删除自己' });
    }
    const r = await pool.query(`DELETE FROM sys_user WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message: '用户不存在' });
    logAction(req, '后台账号', `删除账号 ID=${req.params.id}`);
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
