import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function requireAdminAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: '缺少或无效的授权令牌' });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, env.jwtSecret);

    if (payload.type !== 'admin') {
      return res.status(403).json({ message: '权限不足' });
    }

    req.admin = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

/** 校验是否拥有指定权限码（支持单个或多个 OR 逻辑） */
export function requirePerm(...codes) {
  return (req, res, next) => {
    const perms = req.admin?.perms || [];
    if (perms.includes('*')) return next();
    if (codes.some((c) => perms.includes(c))) return next();
    return res.status(403).json({ message: `权限不足：需要 ${codes.join(' 或 ')}` });
  };
}

/** 是否拥有任一角色码 */
export function requireRole(...codes) {
  return (req, res, next) => {
    const roles = req.admin?.roles || [];
    if (codes.some((c) => roles.includes(c))) return next();
    return res.status(403).json({ message: `角色不足：需要 ${codes.join(' 或 ')}` });
  };
}
