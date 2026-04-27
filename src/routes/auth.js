import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { verifyPassword } from '../utils/password.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { logAction } from '../utils/logger.js';

const router = Router();

async function loadUserAuth(userId) {
  const rolesRes = await pool.query(
    `SELECT r.id, r.role_code, r.role_name
     FROM sys_role r
     JOIN sys_user_role ur ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND r.status = 'enable'`,
    [userId]
  );
  const roles = rolesRes.rows;
  const roleIds = roles.map((r) => r.id);

  let perms = [];
  if (roleIds.length) {
    const permsRes = await pool.query(
      `SELECT DISTINCT m.permission FROM sys_menu m
       JOIN sys_role_menu rm ON rm.menu_id = m.id
       WHERE rm.role_id = ANY($1::bigint[])
         AND m.permission IS NOT NULL AND m.permission <> ''
         AND m.status = 'enable'`,
      [roleIds]
    );
    perms = permsRes.rows.map((r) => r.permission);
  }
  if (roles.some((r) => r.role_code === 'super_admin')) perms = ['*'];
  return { roles, perms };
}

function buildMenuTree(rows) {
  const map = new Map();
  rows.forEach((r) => map.set(Number(r.id), { ...r, id: Number(r.id), parent_id: Number(r.parent_id), children: [] }));
  const roots = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

router.post('/admin/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: '用户名和密码不能为空' });

    const sys = await pool.query(
      `SELECT id, username, password_hash, status, nickname, avatar
       FROM sys_user WHERE username = $1`,
      [username]
    );
    let user = sys.rows[0];
    let source = 'sys_user';
    if (!user) {
      const old = await pool.query(
        `SELECT id, username, password_hash, status FROM admin_users WHERE username = $1`,
        [username]
      );
      user = old.rows[0];
      source = 'admin_users';
    }
    if (!user) return res.status(401).json({ message: '账号不存在' });
    if (user.status && !['active', 'enable'].includes(user.status)) {
      return res.status(401).json({ message: '账号已禁用' });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: '用户名或密码错误' });

    let roles = [];
    let perms = [];
    if (source === 'sys_user') {
      const auth = await loadUserAuth(user.id);
      roles = auth.roles.map((r) => r.role_code);
      perms = auth.perms;
      await pool.query(`UPDATE sys_user SET last_login_at = now() WHERE id = $1`, [user.id]);
    } else {
      roles = ['super_admin'];
      perms = ['*'];
      await pool.query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [user.id]);
    }

    const token = jwt.sign(
      { sub: String(user.id), username: user.username, roles, perms, type: 'admin', source },
      env.jwtSecret,
      { expiresIn: '7d' }
    );

    logAction(
      { admin: { sub: user.id, username: user.username }, headers: req.headers, socket: req.socket },
      '认证', `用户登录：${user.username}`
    );

    return res.json({
      token,
      admin: {
        id: user.id,
        username: user.username,
        nickname: user.nickname || null,
        avatar: user.avatar || null,
        roles,
        perms,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAdminAuth, async (req, res, next) => {
  try {
    const userId = Number(req.admin.sub);
    let roleCodes = req.admin.roles || [];
    let perms = req.admin.perms || [];
    let menus = [];

    if (req.admin.source === 'sys_user') {
      const fresh = await loadUserAuth(userId);
      roleCodes = fresh.roles.map((r) => r.role_code);
      perms = fresh.perms;
      const isSuper = roleCodes.includes('super_admin');
      const menuRes = isSuper
        ? await pool.query(`SELECT id, parent_id, menu_name, path, icon, type, permission, sort
             FROM sys_menu WHERE status = 'enable' ORDER BY sort ASC, id ASC`)
        : await pool.query(
            `SELECT DISTINCT m.id, m.parent_id, m.menu_name, m.path, m.icon, m.type, m.permission, m.sort
             FROM sys_menu m
             JOIN sys_role_menu rm ON rm.menu_id = m.id
             JOIN sys_user_role ur ON ur.role_id = rm.role_id
             WHERE ur.user_id = $1 AND m.status = 'enable'
             ORDER BY m.sort ASC, m.id ASC`,
            [userId]
          );
      menus = buildMenuTree(menuRes.rows);
    } else {
      const menuRes = await pool.query(
        `SELECT id, parent_id, menu_name, path, icon, type, permission, sort
         FROM sys_menu WHERE status = 'enable' ORDER BY sort ASC, id ASC`
      );
      menus = buildMenuTree(menuRes.rows);
    }

    let baseUser = null;
    if (req.admin.source === 'sys_user') {
      const r = await pool.query(
        `SELECT u.id, u.username, u.nickname, u.avatar, u.phone, u.email, u.dept_id,
                u.status, u.last_login_at, u.created_at, d.dept_name
         FROM sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id WHERE u.id = $1`,
        [userId]
      );
      baseUser = r.rows[0] || null;
    } else {
      const r = await pool.query(
        `SELECT id, username, role, status, last_login_at, created_at FROM admin_users WHERE id = $1`,
        [userId]
      );
      baseUser = r.rows[0] || null;
    }

    return res.json({ user: baseUser, roles: roleCodes, perms, menus });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireAdminAuth, (req, res) => {
  logAction(req, '认证', `用户登出：${req.admin.username}`);
  return res.json({ ok: true });
});

export default router;
