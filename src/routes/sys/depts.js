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
        status: item.status,
      };
      if (children.length) node.children = children;
      return node;
    });
}

router.get('/', requirePerm('dept:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, parent_id, dept_name, sort, status, created_at FROM sys_dept ORDER BY sort ASC, id ASC`
    );
    return res.json(rows);
  } catch (e) { return next(e); }
});

router.get('/tree', requirePerm('dept:list'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, parent_id AS "parentId", dept_name AS label, status
       FROM sys_dept
       WHERE status = 'enable'
       ORDER BY sort ASC, id ASC`
    );
    return res.json(buildTree(rows));
  } catch (e) { return next(e); }
});

router.post('/', requirePerm('dept:list'), async (req, res, next) => {
  try {
    const { parent_id = 0, dept_name, sort = 0, status = 'enable' } = req.body || {};
    if (!dept_name) return res.status(400).json({ message: '部门名称必填' });
    const { rows } = await pool.query(
      `INSERT INTO sys_dept (parent_id, dept_name, sort, status) VALUES ($1,$2,$3,$4) RETURNING *`,
      [parent_id, dept_name, sort, status]
    );
    logAction(req, '部门管理', `新增部门：${dept_name}`, { after: rows[0] });
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

router.put('/:id', requirePerm('dept:list'), async (req, res, next) => {
  try {
    const { parent_id, dept_name, sort, status } = req.body || {};
    const before = await pool.query(`SELECT * FROM sys_dept WHERE id = $1`, [req.params.id]);
    const { rows, rowCount } = await pool.query(
      `UPDATE sys_dept SET
         parent_id = COALESCE($1, parent_id),
         dept_name = COALESCE($2, dept_name),
         sort = COALESCE($3, sort),
         status = COALESCE($4, status)
       WHERE id = $5 RETURNING *`,
      [parent_id ?? null, dept_name ?? null, sort ?? null, status ?? null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: '部门不存在' });
    logAction(req, '部门管理', `编辑部门：${rows[0].dept_name}`, { before: before.rows[0] || null, after: rows[0] });
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requirePerm('dept:list'), async (req, res, next) => {
  try {
    const has = await pool.query(`SELECT COUNT(1)::int AS c FROM sys_dept WHERE parent_id = $1`, [req.params.id]);
    if (has.rows[0].c > 0) return res.status(400).json({ message: '请先删除子部门' });
    const before = await pool.query(`SELECT * FROM sys_dept WHERE id = $1`, [req.params.id]);
    const r = await pool.query(`DELETE FROM sys_dept WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ message: '部门不存在' });
    logAction(req, '部门管理', `删除部门 ID=${req.params.id}`, { before: before.rows[0] || null });
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
