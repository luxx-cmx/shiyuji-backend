import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
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

async function getBackupScheduleConfig() {
    const keys = [
        'backup.schedule.enabled',
        'backup.schedule.frequency',
        'backup.schedule.time',
        'backup.schedule.path',
    ];
    const { rows } = await pool.query(
        `SELECT param_key, param_value FROM sys_param WHERE param_key = ANY($1::text[])`,
        [keys]
    );
    const map = Object.fromEntries(rows.map((row) => [row.param_key, row.param_value]));
    return {
        enabled: map['backup.schedule.enabled'] === 'true',
        frequency: map['backup.schedule.frequency'] || 'daily',
        time: map['backup.schedule.time'] || '02:00',
        path: map['backup.schedule.path'] || 'backups',
    };
}

async function setBackupScheduleConfig(config) {
    const entries = [
        ['backup.schedule.enabled', String(Boolean(config.enabled)), '是否启用定时备份'],
        ['backup.schedule.frequency', config.frequency || 'daily', '定时备份频率：daily/weekly'],
        ['backup.schedule.time', config.time || '02:00', '定时备份时间 HH:mm'],
        ['backup.schedule.path', config.path || 'backups', '定时备份保存目录'],
    ];
    for (const [key, value, remark] of entries) {
        await pool.query(
            `INSERT INTO sys_param (param_key, param_value, remark, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (param_key) DO UPDATE SET
               param_value = EXCLUDED.param_value,
               remark = EXCLUDED.remark,
               updated_at = NOW()`,
            [key, value, remark]
        );
    }
    return getBackupScheduleConfig();
}

function resolveBackupDirectory(inputPath) {
    const safePath = String(inputPath || 'backups').trim() || 'backups';
    return path.isAbsolute(safePath) ? safePath : path.join(process.cwd(), safePath);
}

async function writeBackupFile(directory, snapshot) {
    await fs.mkdir(directory, { recursive: true });
    const filename = `shiyuji-backup-${Date.now()}.json`;
    const fullPath = path.join(directory, filename);
    await fs.writeFile(fullPath, JSON.stringify(snapshot, null, 2), 'utf8');
    return { filename, fullPath };
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
        logAction(req, '数据备份', '导出在线备份', { counts: snapshot.counts, generatedAt: snapshot.generatedAt });
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

router.get('/schedule', async (req, res, next) => {
    try {
        return res.json(await getBackupScheduleConfig());
    } catch (error) {
        return next(error);
    }
});

router.put('/schedule', async (req, res, next) => {
    try {
        const { enabled = false, frequency = 'daily', time = '02:00', path: backupPath = 'backups' } = req.body || {};
        if (!['daily', 'weekly'].includes(frequency)) {
            return res.status(400).json({ message: 'frequency 仅支持 daily/weekly' });
        }
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            return res.status(400).json({ message: 'time 格式必须为 HH:mm' });
        }
        const saved = await setBackupScheduleConfig({ enabled, frequency, time, path: backupPath });
        logAction(req, '数据备份', '更新定时备份配置', { after: saved });
        return res.json(saved);
    } catch (error) {
        return next(error);
    }
});

router.post('/schedule/run', async (req, res, next) => {
    try {
        const config = await getBackupScheduleConfig();
        const snapshot = await exportSnapshot();
        const directory = resolveBackupDirectory(config.path);
        const file = await writeBackupFile(directory, snapshot);
        const result = {
            ok: true,
            generatedAt: snapshot.generatedAt,
            path: file.fullPath,
            filename: file.filename,
            counts: snapshot.counts,
        };
        logAction(req, '数据备份', '立即执行计划备份', { config, file: { filename: file.filename, path: file.fullPath }, counts: snapshot.counts });
        return res.json(result);
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
        logAction(req, '数据备份', '恢复在线备份', { restored });
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