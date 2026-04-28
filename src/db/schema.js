import { pool } from './pool.js';
import { hashPasswordSync, sha256 } from '../utils/password.js';
import { SEED_ROLES, SEED_MENU_TREE } from './rbacSeed.js';

export async function ensureSchema() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id bigserial PRIMARY KEY,
        username text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        nickname text,
        avatar text,
        target_weight numeric,
        daily_target_calorie int DEFAULT 1800,
        gender text,
        height int,
        age int,
        activity_level text,
        skin_type int DEFAULT 0,
        status text DEFAULT 'active',
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_goals (
        id bigserial PRIMARY KEY,
        user_id bigint UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        calorie_target int DEFAULT 1800,
        water_target int DEFAULT 2000,
        steps_target int DEFAULT 8000,
        sleep_target numeric DEFAULT 8,
        exercise_target int DEFAULT 300,
        updated_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS profile_data (
        id bigserial PRIMARY KEY,
        user_id bigint UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS foods (
        id bigserial PRIMARY KEY,
        name text UNIQUE NOT NULL,
        category text NOT NULL,
        calories int NOT NULL,
        protein numeric DEFAULT 0,
        fat numeric DEFAULT 0,
        carbohydrate numeric DEFAULT 0,
        audit_status text DEFAULT 'approved',
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS diet_records (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_id text,
        meal text,
        name text,
        calories int,
        date date,
        created_at timestamptz DEFAULT now(),
        UNIQUE (user_id, local_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS weight_records (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_id text,
        weight numeric,
        date date,
        note text,
        created_at timestamptz DEFAULT now(),
        UNIQUE (user_id, local_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS exercise_records (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exercise_type text,
        calories int,
        duration int,
        date date,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS health_records (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        metrics jsonb DEFAULT '{}'::jsonb,
        date date,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id bigserial PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        food_id bigint NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
        created_at timestamptz DEFAULT now(),
        UNIQUE (user_id, food_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id bigserial PRIMARY KEY,
        user_id bigint UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        settings jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_update_record (
        id bigserial PRIMARY KEY,
        version text UNIQUE NOT NULL,
        release_notes text,
        release_date date,
        force_update boolean DEFAULT false,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';`);
    await client.query(`ALTER TABLE app_update_record ADD COLUMN IF NOT EXISTS release_notes text;`);
    await client.query(`ALTER TABLE app_update_record ADD COLUMN IF NOT EXISTS release_date date;`);
    await client.query(`ALTER TABLE app_update_record ADD COLUMN IF NOT EXISTS force_update boolean DEFAULT false;`);
    await client.query(`ALTER TABLE app_update_record ADD COLUMN IF NOT EXISTS update_time timestamptz DEFAULT now();`);
    await client.query(`ALTER TABLE app_update_record ALTER COLUMN update_time SET DEFAULT now();`);
    await client.query(`ALTER TABLE foods ADD COLUMN IF NOT EXISTS protein numeric DEFAULT 0;`);
    await client.query(`ALTER TABLE foods ADD COLUMN IF NOT EXISTS fat numeric DEFAULT 0;`);
    await client.query(`ALTER TABLE foods ADD COLUMN IF NOT EXISTS carbohydrate numeric DEFAULT 0;`);
    await client.query(`ALTER TABLE foods ADD COLUMN IF NOT EXISTS audit_status text DEFAULT 'approved';`);
    await client.query(`UPDATE foods SET audit_status = 'approved' WHERE audit_status IS NULL;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id bigserial PRIMARY KEY,
        username text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        role text DEFAULT 'admin',
        status text DEFAULT 'active',
        created_at timestamptz DEFAULT now(),
        last_login_at timestamptz
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_operation_logs (
        id bigserial PRIMARY KEY,
        admin_user_id bigint REFERENCES admin_users(id) ON DELETE SET NULL,
        action text NOT NULL,
        target_type text,
        target_id text,
        payload jsonb,
        created_at timestamptz DEFAULT now()
      );
    `);

    /* ===================== RBAC 权限体系（sys_*） ===================== */

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_dept (
        id bigserial PRIMARY KEY,
        parent_id bigint DEFAULT 0,
        dept_name text NOT NULL,
        sort int DEFAULT 0,
        status text DEFAULT 'enable',
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_menu (
        id bigserial PRIMARY KEY,
        parent_id bigint DEFAULT 0,
        menu_name text NOT NULL,
        path text,
        icon text,
        type text DEFAULT 'menu',
        permission text,
        sort int DEFAULT 0,
        status text DEFAULT 'enable',
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_role (
        id bigserial PRIMARY KEY,
        role_name text NOT NULL UNIQUE,
        role_code text UNIQUE,
        status text DEFAULT 'enable',
        remark text,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_role_menu (
        role_id bigint NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
        menu_id bigint NOT NULL REFERENCES sys_menu(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, menu_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_user (
        id bigserial PRIMARY KEY,
        username text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        nickname text,
        avatar text,
        phone text,
        email text,
        dept_id bigint REFERENCES sys_dept(id) ON DELETE SET NULL,
        status text DEFAULT 'enable',
        last_login_at timestamptz,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_user_role (
        user_id bigint NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
        role_id bigint NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_operation_log (
        id bigserial PRIMARY KEY,
        user_id bigint,
        username text,
        module text,
        content text,
        details jsonb,
        ip text,
        created_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`ALTER TABLE sys_operation_log ADD COLUMN IF NOT EXISTS details jsonb;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sys_param (
        id bigserial PRIMARY KEY,
        param_key text UNIQUE NOT NULL,
        param_value text,
        remark text,
        updated_at timestamptz DEFAULT now()
      );
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS sys_menu_parent ON sys_menu(parent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS sys_user_dept ON sys_user(dept_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS sys_op_log_user ON sys_operation_log(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS sys_op_log_time ON sys_operation_log(created_at DESC);`);

    await client.query(`CREATE INDEX IF NOT EXISTS foods_category ON foods(category);`);
    await client.query(`CREATE INDEX IF NOT EXISTS diet_uid_date ON diet_records(user_id, date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS weight_uid_date ON weight_records(user_id, date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS exercise_uid_date ON exercise_records(user_id, date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS health_uid_date ON health_records(user_id, date DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS favorites_uid ON favorites(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS profile_data_uid ON profile_data(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS user_settings_uid ON user_settings(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS app_update_record_version ON app_update_record(version);`);

    await seedInitialAppUpdates(client);
    await seedDefaultAdmin(client);
    await seedRbac(client);
    await seedDefaultParams(client);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedDefaultAdmin(client) {
  const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
  const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const passwordHash = sha256(defaultPassword);

  await client.query(
    `INSERT INTO admin_users (username, password_hash, role, status)
     VALUES ($1, $2, 'super_admin', 'active')
     ON CONFLICT (username) DO NOTHING`,
    [defaultUsername, passwordHash]
  );
}

/* ===================== RBAC 种子 ===================== */

async function seedRbac(client) {
  // 1. 默认部门
  await client.query(
    `INSERT INTO sys_dept (parent_id, dept_name, sort, status)
     VALUES (0, '总部', 0, 'enable')
     ON CONFLICT DO NOTHING`
  );
  // 由于 dept_name 没有唯一约束，使用 select 查找
  let deptId;
  const deptCheck = await client.query(`SELECT id FROM sys_dept WHERE dept_name = '总部' LIMIT 1`);
  if (deptCheck.rows[0]) {
    deptId = deptCheck.rows[0].id;
  } else {
    const ins = await client.query(`INSERT INTO sys_dept (parent_id, dept_name) VALUES (0, '总部') RETURNING id`);
    deptId = ins.rows[0].id;
  }

  // 2. 角色
  for (const r of SEED_ROLES) {
    await client.query(
      `INSERT INTO sys_role (role_name, role_code, remark, status)
       VALUES ($1, $2, $3, 'enable')
       ON CONFLICT (role_name) DO NOTHING`,
      [r.role_name, r.role_code, r.remark]
    );
  }

  // 3. 菜单（递归插入，name+permission 作为去重键）
  const insertMenu = async (m, parentId, sort) => {
    const existing = await client.query(
      `SELECT id FROM sys_menu
       WHERE menu_name = $1 AND COALESCE(permission,'') = COALESCE($2,'')
         AND parent_id = $3 LIMIT 1`,
      [m.menu_name, m.permission || null, parentId]
    );
    let id;
    if (existing.rows[0]) {
      id = existing.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO sys_menu (parent_id, menu_name, path, icon, type, permission, sort)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [parentId, m.menu_name, m.path || null, m.icon || null, m.type || 'menu', m.permission || null, sort]
      );
      id = ins.rows[0].id;
    }
    if (m.children && m.children.length) {
      let i = 0;
      for (const ch of m.children) {
        i++;
        await insertMenu(ch, id, i);
      }
    }
    return id;
  };

  let topSort = 0;
  for (const node of SEED_MENU_TREE) {
    topSort++;
    await insertMenu(node, 0, node.sort || topSort);
  }

  // 4. 角色-菜单绑定
  const { ROLE_PERMS } = await import('./rbacSeed.js');

  // super_admin -> 全部菜单
  const superRoleRow = await client.query(`SELECT id FROM sys_role WHERE role_code = 'super_admin'`);
  if (superRoleRow.rows[0]) {
    const rid = superRoleRow.rows[0].id;
    await client.query(
      `INSERT INTO sys_role_menu (role_id, menu_id)
       SELECT $1, id FROM sys_menu
       ON CONFLICT DO NOTHING`,
      [rid]
    );
  }

  for (const code of ['admin', 'user', 'guest']) {
    const roleRow = await client.query(`SELECT id FROM sys_role WHERE role_code = $1`, [code]);
    if (!roleRow.rows[0]) continue;
    const rid = roleRow.rows[0].id;
    const perms = ROLE_PERMS[code] || [];
    if (Array.isArray(perms) && perms.length) {
      await client.query(
        `INSERT INTO sys_role_menu (role_id, menu_id)
         SELECT $1, id FROM sys_menu WHERE permission = ANY($2::text[])
         ON CONFLICT DO NOTHING`,
        [rid, perms]
      );
    }
  }

  // 5. 默认 super_admin 用户（同步管理后台登录账号）
  const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
  const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const bcryptHash = hashPasswordSync(defaultPassword);

  const sysUser = await client.query(
    `SELECT id FROM sys_user WHERE username = $1`,
    [defaultUsername]
  );
  let sysUserId;
  if (sysUser.rows[0]) {
    sysUserId = sysUser.rows[0].id;
  } else {
    const ins = await client.query(
      `INSERT INTO sys_user (username, password_hash, nickname, dept_id, status)
       VALUES ($1, $2, '超级管理员', $3, 'enable') RETURNING id`,
      [defaultUsername, bcryptHash, deptId]
    );
    sysUserId = ins.rows[0].id;
  }
  if (superRoleRow.rows[0]) {
    await client.query(
      `INSERT INTO sys_user_role (user_id, role_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sysUserId, superRoleRow.rows[0].id]
    );
  }
}

async function seedDefaultParams(client) {
  const defaults = [
    { key: 'dashboard.refresh.seconds', value: '300', remark: '看板自动刷新秒数' },
    { key: 'user.inactive.days', value: '30', remark: '流失用户判定天数' },
    { key: 'food.alert.daily.threshold', value: '50', remark: '每日新增食物预警阈值' },
    { key: 'backup.schedule.enabled', value: 'false', remark: '是否启用定时备份' },
    { key: 'backup.schedule.frequency', value: 'daily', remark: '定时备份频率：daily/weekly' },
    { key: 'backup.schedule.time', value: '02:00', remark: '定时备份时间 HH:mm' },
    { key: 'backup.schedule.path', value: 'backups', remark: '定时备份保存目录' },
  ];
  for (const p of defaults) {
    await client.query(
      `INSERT INTO sys_param (param_key, param_value, remark)
       VALUES ($1, $2, $3) ON CONFLICT (param_key) DO NOTHING`,
      [p.key, p.value, p.remark]
    );
  }
}

async function seedInitialAppUpdates(client) {
  const columnResult = await client.query(
    `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'app_update_record'`
  );

  const availableColumns = new Set(columnResult.rows.map((r) => r.column_name));
  const unsupportedRequiredColumns = columnResult.rows.filter(
    (r) => r.is_nullable === 'NO' && !r.column_default && !['id', 'version', 'release_notes', 'release_date', 'force_update', 'created_at', 'update_time'].includes(r.column_name)
  );

  if (unsupportedRequiredColumns.length > 0) {
    return;
  }

  const updates = [
    {
      version: 'v2.0.0',
      notes: '新增饮食记录与热量统计基础能力',
      date: '2024-03-01',
      force: false,
    },
    {
      version: 'v2.5.0',
      notes: '增加体重趋势分析与目标管理',
      date: '2024-06-15',
      force: false,
    },
    {
      version: 'v3.0.0',
      notes: '上线食物库分类与搜索能力',
      date: '2024-09-10',
      force: false,
    },
    {
      version: 'v3.2.0',
      notes: '新增收藏功能与推荐策略优化',
      date: '2024-11-28',
      force: false,
    },
    {
      version: 'v3.5.0',
      notes: '完善用户行为分析与看板能力',
      date: '2025-01-20',
      force: false,
    },
    {
      version: 'v4.0.0',
      notes: '管理后台权限体系升级与稳定性增强',
      date: '2025-04-12',
      force: true,
    },
  ];

  for (const item of updates) {
    const columns = ['version'];
    const values = [item.version];

    if (availableColumns.has('release_notes')) {
      columns.push('release_notes');
      values.push(item.notes);
    }
    if (availableColumns.has('release_date')) {
      columns.push('release_date');
      values.push(item.date);
    }
    if (availableColumns.has('force_update')) {
      columns.push('force_update');
      values.push(item.force);
    }
    if (availableColumns.has('update_time')) {
      columns.push('update_time');
      values.push(new Date().toISOString());
    }

    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    await client.query(
      `INSERT INTO app_update_record (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (version) DO NOTHING`,
      values
    );
  }
}
