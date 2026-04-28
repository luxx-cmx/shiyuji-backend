import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';

const router = Router();
router.use(requireAdminAuth);

function buildTree(list, parentId = 0) {
  return list
    .filter((item) => Number(item.parentId || 0) === Number(parentId))
    .map((item) => {
      const children = buildTree(list, item.id);
      const node = {
        id: Number(item.id),
        label: item.label,
        parentId: Number(item.parentId || 0),
        type: item.type,
        permission: item.permission,
        status: item.status,
      };
      if (children.length) node.children = children;
      return node;
    });
}

router.get('/', requirePerm('menu:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, parent_id, menu_name, path, icon, type, permission, sort, status, created_at
       FROM sys_menu ORDER BY sort ASC, id ASC`
    );
    return res.json(rows);
  } catch (e) { return next(e); }
});

router.get('/tree', requirePerm('menu:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, parent_id AS "parentId", menu_name AS label, type, permission, status
       FROM sys_menu
       WHERE status = 'enable'
       ORDER BY sort ASC, id ASC`
    );
    return res.json(buildTree(rows));
  } catch (e) { return next(e); }
});

router.post('/', requirePerm('menu:list'), async (req, res, next) => {
  try {
    const { parent_id = 0, menu_name, path, icon, type = 'menu', permission, sort = 0, status = 'enable' } = req.body || {};
    if (!menu_name) return res.status(400).json({ message: '菜单名称必填' });
    const { rows } = await pool.query(
      `INSERT INTO sys_menu (parent_id, menu_name, path, icon, type, permission, sort, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [parent_id, menu_name, path || null, icon || null, type, permission || null, sort, status]
    );
    logAction(req, '菜单管理', `新增菜单：${menu_name}`, { after: rows[0] });
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

router.put('/:id', requirePerm('menu:list'), async (req, res, next) => {
  try {
    const { parent_id, menu_name, path, icon, type, permission, sort, status } = req.body || {};
    const before = await pool.query(`SELECT * FROM sys_menu WHERE id = $1`, [req.params.id]);
    const { rows, rowCount } = await pool.query(
      `UPDATE sys_menu SET
         parent_id = COALESCE($1, parent_id),
         menu_name = COALESCE($2, menu_name),
         path = COALESCE($3, path),
         icon = COALESCE($4, icon),
         type = COALESCE($5, type),
         permission = COALESCE($6, permission),
         sort = COALESCE($7, sort),
         status = COALESCE($8, status)
       WHERE id = $9 RETURNING *`,
      [parent_id ?? null, menu_name ?? null, path ?? null, icon ?? null, type ?? null, permission ?? null, sort ?? null, status ?? null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: '菜单不存在' });
    logAction(req, '菜单管理', `编辑菜单：${rows[0].menu_name}`, { before: before.rows[0] || null, after: rows[0] });
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requirePerm('menu:list'), async (req, res, next) => {
  try {
    const has = await pool.query(`SELECT COUNT(1)::int AS c FROM sys_menu WHERE parent_id = $1`, [req.params.id]);
    if (has.rows[0].c > 0) return res.status(400).json({ message: '请先删除子菜单' });
    const before = await pool.query(`SELECT * FROM sys_menu WHERE id = $1`, [req.params.id]);
    const r = await pool.query(`DELETE FROM sys_menu WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message: '菜单不存在' });
    logAction(req, '菜单管理', `删除菜单 ID=${req.params.id}`, { before: before.rows[0] || null });
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
