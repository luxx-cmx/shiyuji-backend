import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth, requirePerm } from '../middleware/auth.js';
import { logAction } from '../utils/logger.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const {
      category,
      auditStatus,
      keyword,
      sortBy = 'id',
      order = 'desc',
      page = 1,
      pageSize = 20,
    } = req.query;

    const where = [];
    const values = [];

    if (category) {
      values.push(category);
      where.push(`category = $${values.length}`);
    }

    if (keyword) {
      values.push(`%${keyword}%`);
      where.push(`name ILIKE $${values.length}`);
    }

    if (auditStatus) {
      values.push(auditStatus);
      where.push(`COALESCE(audit_status, 'approved') = $${values.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sortField = ['id', 'name', 'calories', 'created_at', 'category'].includes(sortBy)
      ? sortBy
      : 'id';
    const sortOrder = order?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const offset = (Number(page) - 1) * Number(pageSize);
    values.push(Number(pageSize));
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const listSql = `
            SELECT id, name, category, calories, protein, fat, carbohydrate,
              COALESCE(audit_status, 'approved') AS audit_status, created_at
      FROM foods
      ${whereClause}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const totalSql = `SELECT COUNT(1)::int AS total FROM foods ${whereClause}`;

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

router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, COUNT(1)::int AS count
       FROM foods
       GROUP BY category
       ORDER BY count DESC, category ASC`
    );

    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/export/csv', requireAdminAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, category, calories, protein, fat, carbohydrate, COALESCE(audit_status, 'approved') AS audit_status, created_at
       FROM foods
       ORDER BY id DESC
       LIMIT 50000`
    );

    const header = 'id,name,category,calories,protein,fat,carbohydrate,audit_status,created_at';
    const lines = rows.map((r) =>
      [
        r.id,
        (r.name || '').replaceAll(',', '，'),
        (r.category || '').replaceAll(',', '，'),
        r.calories,
        r.protein || 0,
        r.fat || 0,
        r.carbohydrate || 0,
        r.audit_status,
        r.created_at.toISOString(),
      ].join(',')
    );

    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="foods-export.csv"');
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT id, name, category, calories, protein, fat, carbohydrate,
              COALESCE(audit_status, 'approved') AS audit_status, created_at
       FROM foods
       WHERE id = $1`,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: '食物不存在' });
    }

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.use(requireAdminAuth);

router.post('/', requirePerm('food:add'), async (req, res, next) => {
  try {
    const { name, category, calories, protein = 0, fat = 0, carbohydrate = 0, audit_status = 'approved' } = req.body;

    if (!name || !category || Number.isNaN(Number(calories))) {
      return res.status(400).json({ message: 'name/category/calories 必填' });
    }

    const { rows } = await pool.query(
      `INSERT INTO foods (name, category, calories, protein, fat, carbohydrate, audit_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, category, calories, protein, fat, carbohydrate, audit_status, created_at`,
      [name.trim(), category.trim(), Number(calories), Number(protein) || 0, Number(fat) || 0, Number(carbohydrate) || 0, audit_status]
    );

    logAction(req, '食物管理', `新增食物：${rows[0].name}`, { after: rows[0] });
    return res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '食物名称已存在' });
    }
    return next(error);
  }
});

router.post('/batch', requirePerm('food:batchImport'), async (req, res, next) => {
  try {
    const { items = [] } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items 不能为空数组' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const item of items) {
        const { name, category, calories } = item;
        if (!name || !category || Number.isNaN(Number(calories))) {
          continue;
        }

        const result = await client.query(
          `INSERT INTO foods (name, category, calories)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO NOTHING`,
          [name.trim(), category.trim(), Number(calories)]
        );

        inserted += result.rowCount;
      }
      await client.query('COMMIT');
      return res.json({ inserted, received: items.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/audit', requirePerm('food:audit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { audit_status } = req.body || {};
    if (!['pending', 'approved', 'rejected'].includes(audit_status)) {
      return res.status(400).json({ message: 'audit_status 仅支持 pending/approved/rejected' });
    }
    const before = await pool.query(`SELECT id, name, audit_status FROM foods WHERE id = $1`, [id]);
    const { rows, rowCount } = await pool.query(
      `UPDATE foods SET audit_status = $1 WHERE id = $2
       RETURNING id, name, category, calories, protein, fat, carbohydrate, audit_status, created_at`,
      [audit_status, id]
    );
    if (!rowCount) return res.status(404).json({ message: '食物不存在' });
    logAction(req, '食物审核', `审核食物：${rows[0].name} -> ${audit_status}`, { before: before.rows[0] || null, after: rows[0] });
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', requirePerm('food:edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category, calories, protein, fat, carbohydrate, audit_status } = req.body;
    const before = await pool.query(`SELECT * FROM foods WHERE id = $1`, [id]);

    const result = await pool.query(
      `UPDATE foods
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           calories = COALESCE($3, calories),
           protein = COALESCE($4, protein),
           fat = COALESCE($5, fat),
           carbohydrate = COALESCE($6, carbohydrate),
           audit_status = COALESCE($7, audit_status)
       WHERE id = $8
       RETURNING id, name, category, calories, protein, fat, carbohydrate, audit_status, created_at`,
      [name?.trim(), category?.trim(), calories ?? null, protein ?? null, fat ?? null, carbohydrate ?? null, audit_status ?? null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '食物不存在' });
    }

    logAction(req, '食物管理', `编辑食物：${result.rows[0].name}`, { before: before.rows[0] || null, after: result.rows[0] });
    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '食物名称已存在' });
    }
    return next(error);
  }
});

router.delete('/:id', requirePerm('food:delete'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const before = await pool.query(`SELECT * FROM foods WHERE id = $1`, [id]);
    const result = await pool.query('DELETE FROM foods WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '食物不存在' });
    }

    logAction(req, '食物管理', `删除食物 ID=${id}`, { before: before.rows[0] || null });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post('/batch-delete', requirePerm('food:batchDelete'), async (req, res, next) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids 不能为空数组' });
    }

    const result = await pool.query('DELETE FROM foods WHERE id = ANY($1::bigint[])', [ids]);
    return res.json({ deleted: result.rowCount });
  } catch (error) {
    return next(error);
  }
});

export default router;
