import { pool } from '../db/pool.js';

/** 异步记录操作日志（不阻塞响应） */
export function logAction(req, module, content) {
  const user = req.admin || {};
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();

  // fire-and-forget
  pool.query(
    `INSERT INTO sys_operation_log (user_id, username, module, content, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.sub ? Number(user.sub) : null, user.username || null, module, content, ip || null]
  ).catch((err) => console.error('logAction error:', err.message));
}
