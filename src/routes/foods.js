import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAdminAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const {
      category,
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
      SELECT id, name, category, calories, created_at
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
      `SELECT id, name, category, calories, created_at
       FROM foods
       ORDER BY id DESC
       LIMIT 50000`
    );

    const header = 'id,name,category,calories,created_at';
    const lines = rows.map((r) =>
      [
        r.id,
        (r.name || '').replaceAll(',', '，'),
        (r.category || '').replaceAll(',', '，'),
        r.calories,
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
      `SELECT id, name, category, calories, created_at
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

router.post('/', async (req, res, next) => {
  try {
    const { name, category, calories } = req.body;

    if (!name || !category || Number.isNaN(Number(calories))) {
      return res.status(400).json({ message: 'name/category/calories 必填' });
    }

    const { rows } = await pool.query(
      `INSERT INTO foods (name, category, calories)
       VALUES ($1, $2, $3)
       RETURNING id, name, category, calories, created_at`,
      [name.trim(), category.trim(), Number(calories)]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '食物名称已存在' });
    }
    return next(error);
  }
});

router.post('/batch', async (req, res, next) => {
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

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, category, calories } = req.body;

    const result = await pool.query(
      `UPDATE foods
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           calories = COALESCE($3, calories)
       WHERE id = $4
       RETURNING id, name, category, calories, created_at`,
      [name?.trim(), category?.trim(), calories ?? null, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '食物不存在' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '食物名称已存在' });
    }
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM foods WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: '食物不存在' });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post('/batch-delete', async (req, res, next) => {
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
