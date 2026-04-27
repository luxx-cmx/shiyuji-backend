import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/', requirePerm('role:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role_name, role_code, status, remark, created_at FROM sys_role ORDER BY id ASC`
    );
    return res.json(rows);
  } catch (e) { return next(e); }
});

router.get('/:id/menus', requirePerm('role:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT menu_id FROM sys_role_menu WHERE role_id = $1`,
      [req.params.id]
    );
    return res.json(rows.map((r) => Number(r.menu_id)));
  } catch (e) { return next(e); }
});

router.post('/', requirePerm('role:list'), async (req, res, next) => {
  try {
    const { role_name, role_code, remark, status = 'enable' } = req.body || {};
    if (!role_name || !role_code) return res.status(400).json({ message: '角色名称与编码必填' });
    const { rows } = await pool.query(
      `INSERT INTO sys_role (role_name, role_code, remark, status) VALUES ($1,$2,$3,$4) RETURNING *`,
      [role_name, role_code, remark || null, status]
    );
    logAction(req, '角色管理', `新增角色：${role_name}(${role_code})`);
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: '角色名称或编码已存在' });
    return next(e);
  }
});

router.put('/:id', requirePerm('role:list'), async (req, res, next) => {
  try {
    const { role_name, role_code, remark, status } = req.body || {};
    const { rows, rowCount } = await pool.query(
      `UPDATE sys_role SET
         role_name = COALESCE($1, role_name),
         role_code = COALESCE($2, role_code),
         remark = COALESCE($3, remark),
         status = COALESCE($4, status)
       WHERE id = $5 RETURNING *`,
      [role_name ?? null, role_code ?? null, remark ?? null, status ?? null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: '角色不存在' });
    logAction(req, '角色管理', `编辑角色：${rows[0].role_name}`);
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requirePerm('role:list'), async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM sys_role WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message: '角色不存在' });
    logAction(req, '角色管理', `删除角色 ID=${req.params.id}`);
    return res.status(204).send();
  } catch (e) { return next(e); }
});

router.put('/:id/menus', requirePerm('role:list'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { menuIds = [] } = req.body || {};
    if (!Array.isArray(menuIds)) return res.status(400).json({ message: 'menuIds 必须为数组' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM sys_role_menu WHERE role_id = $1`, [req.params.id]);
    for (const mid of menuIds) {
      await client.query(`INSERT INTO sys_role_menu (role_id, menu_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, mid]);
    }
    await client.query('COMMIT');
    logAction(req, '角色管理', `更新角色 ${req.params.id} 菜单权限：${menuIds.length} 项`);
    return res.json({ ok: true, count: menuIds.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally { client.release(); }
});

export default router;
