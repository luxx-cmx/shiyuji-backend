import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';

const router = Router();
router.use(requireAdminAuth);

router.get('/', requirePerm('system:param'), async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT id, param_key, param_value, remark, updated_at FROM sys_param ORDER BY param_key ASC`);
    return res.json(r.rows);
  } catch (e) { return next(e); }
});

router.put('/:key', requirePerm('system:param'), async (req, res, next) => {
  try {
    const { param_value, remark } = req.body || {};
    const before = await pool.query(`SELECT param_key, param_value, remark, updated_at FROM sys_param WHERE param_key = $1`, [req.params.key]);
    const r = await pool.query(
      `INSERT INTO sys_param (param_key, param_value, remark, updated_at)
       VALUES ($1,$2,$3, NOW())
       ON CONFLICT (param_key) DO UPDATE SET
         param_value = EXCLUDED.param_value,
         remark = COALESCE(EXCLUDED.remark, sys_param.remark),
         updated_at = NOW()
       RETURNING id, param_key, param_value, remark, updated_at`,
      [req.params.key, String(param_value ?? ''), remark || null]
    );
    logAction(req, '系统参数', `更新参数：${req.params.key}`, { before: before.rows[0] || null, after: r.rows[0] });
    return res.json(r.rows[0]);
  } catch (e) { return next(e); }
});

export default router;
