import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/', requirePerm('system:foodCategory', 'food:list'), async (_req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT category AS name, COUNT(1)::int AS food_count
       FROM foods
       WHERE category IS NOT NULL AND category <> ''
       GROUP BY category
       ORDER BY food_count DESC, category ASC`
    );
    return res.json(r.rows);
  } catch (e) { return next(e); }
});

router.put('/rename', requirePerm('system:foodCategory'), async (req, res, next) => {
  try {
    const { oldName, newName } = req.body || {};
    if (!oldName || !newName) return res.status(400).json({ message: '原名称和新名称必填' });
    const r = await pool.query(`UPDATE foods SET category = $1 WHERE category = $2`, [newName, oldName]);
    logAction(req, '食物分类', `重命名分类：${oldName} -> ${newName}`);
    return res.json({ updated: r.rowCount });
  } catch (e) { return next(e); }
});

router.delete('/:name', requirePerm('system:foodCategory'), async (req, res, next) => {
  try {
    const cnt = await pool.query(`SELECT COUNT(1)::int AS c FROM foods WHERE category = $1`, [req.params.name]);
    if (cnt.rows[0].c > 0) return res.status(400).json({ message: '该分类下仍有食物，无法删除' });
    logAction(req, '食物分类', `删除分类：${req.params.name}`);
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
