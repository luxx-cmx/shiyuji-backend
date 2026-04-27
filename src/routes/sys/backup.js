import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireAdminAuth, requirePerm } from '../../middleware/auth.js';
import { logAction } from '../../utils/logger.js';

const router = Router();

const BACKUP_TABLES = [
    'users',
    'user_goals',
    'profile_data',
    'foods',
    'diet_records',
    'weight_records',
    'exercise_records',
    'health_records',
    'favorites',
    'user_settings',
    'app_update_record',
    'admin_users',
    'admin_operation_logs',
    'sys_dept',
    'sys_menu',
    'sys_role',
    'sys_role_menu',
    'sys_user',
    'sys_user_role',
    'sys_operation_log',
    'sys_param',
];

router.use(requireAdminAuth);
router.use(requirePerm('system:backup'));

function quoteIdent(identifier) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
        throw new Error(`非法标识符: ${identifier}`);
    }
    return `"${identifier}"`;
}

function chunkRows(rows, size) {
    const chunks = [];
    for (let index = 0; index < rows.length; index += size) {
        chunks.push(rows.slice(index, index + size));
    }
    return chunks;
}

async function exportSnapshot() {
    const tables = {};
    const counts = {};

    for (const table of BACKUP_TABLES) {
        const { rows } = await pool.query(`SELECT * FROM ${quoteIdent(table)}`);
        tables[table] = rows;
        counts[table] = rows.length;
    }

    return {
        type: 'shiyuji-backup',
        version: 1,
        generatedAt: new Date().toISOString(),
        tables,
        counts,
    };
}

async function getSnapshotSummary() {
    const counts = {};
    let totalRecords = 0;

    for (const table of BACKUP_TABLES) {
        const { rows } = await pool.query(`SELECT COUNT(1)::int AS count FROM ${quoteIdent(table)}`);
        const count = rows[0]?.count || 0;
        counts[table] = count;
        totalRecords += count;
    }

    return {
        generatedAt: new Date().toISOString(),
        tableCount: BACKUP_TABLES.length,
        totalRecords,
        counts,
    };
}

async function restoreTableRows(client, table, rows) {
    if (!rows.length) {
        return 0;
    }

    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const columnSql = columns.map(quoteIdent).join(', ');
    let inserted = 0;

    for (const chunk of chunkRows(rows, 200)) {
        const values = [];
        const placeholders = chunk.map((row, rowIndex) => {
            const rowPlaceholders = columns.map((column, columnIndex) => {
                values.push(row[column] ?? null);
                return `$${rowIndex * columns.length + columnIndex + 1}`;
            });
            return `(${rowPlaceholders.join(', ')})`;
        });

        await client.query(
            `INSERT INTO ${quoteIdent(table)} (${columnSql}) VALUES ${placeholders.join(', ')}`,
            values
        );
        inserted += chunk.length;
    }

    return inserted;
}

async function syncIdSequence(client, table) {
    const columnResult = await client.query(
        `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'`,
        [table]
    );
    if (!columnResult.rowCount) {
        return;
    }

    const { rows } = await client.query(
        `SELECT pg_get_serial_sequence($1, 'id') AS sequence_name`,
        [`public.${table}`]
    );
    const sequenceName = rows[0]?.sequence_name;
    if (!sequenceName) {
        return;
    }

    await client.query(
        `SELECT setval($1::regclass, GREATEST(COALESCE(MAX(id), 0), 1), COALESCE(MAX(id), 0) > 0)
     FROM ${quoteIdent(table)}`,
        [sequenceName]
    );
}

router.get('/export', async (req, res, next) => {
    try {
        const snapshot = await exportSnapshot();
        logAction(req, '数据备份', '导出在线备份');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="shiyuji-backup-${Date.now()}.json"`);
        return res.send(JSON.stringify(snapshot, null, 2));
    } catch (error) {
        return next(error);
    }
});

router.get('/summary', async (req, res, next) => {
    try {
        return res.json(await getSnapshotSummary());
    } catch (error) {
        return next(error);
    }
});

router.post('/restore', async (req, res, next) => {
    const snapshot = req.body;
    if (!snapshot || snapshot.type !== 'shiyuji-backup' || typeof snapshot.tables !== 'object') {
        return res.status(400).json({ message: '备份文件格式不正确' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `TRUNCATE TABLE ${BACKUP_TABLES.map((table) => `public.${quoteIdent(table)}`).join(', ')} RESTART IDENTITY CASCADE`
        );

        const restored = {};
        for (const table of BACKUP_TABLES) {
            const rows = Array.isArray(snapshot.tables[table]) ? snapshot.tables[table] : [];
            restored[table] = await restoreTableRows(client, table, rows);
            await syncIdSequence(client, table);
        }

        await client.query('COMMIT');
        logAction(req, '数据备份', '恢复在线备份');
        return res.json({
            ok: true,
            restored,
            restoredAt: new Date().toISOString(),
        });
    } catch (error) {
        await client.query('ROLLBACK');
        return next(error);
    } finally {
        client.release();
    }
});

export default router;