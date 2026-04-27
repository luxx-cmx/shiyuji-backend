/**
 * RBAC 种子数据：菜单树 + 角色 + 角色菜单绑定 + 默认部门与超级管理员
 * 与文档「食愈记管理后端权限体系+完整管理后台功能文档」保持一致
 */

export const SEED_ROLES = [
  { role_name: '超级管理员', role_code: 'super_admin', remark: '拥有系统全部操作权限，可管理所有模块，包括系统设置、数据备份恢复' },
  { role_name: '运营管理员', role_code: 'admin', remark: '负责用户管理、食物管理、数据分析，无权限管理及系统设置功能' },
  { role_name: '普通注册用户', role_code: 'user', remark: '仅能查看和管理自身相关数据，无后台管理权限' },
  { role_name: '只读游客', role_code: 'guest', remark: '仅能查看公开数据，无任何编辑操作权限' },
];

/** 菜单树：parent 用 name 引用，运行时解析为 parent_id */
export const SEED_MENU_TREE = [
  {
    menu_name: '数据看板', path: '/dashboard', icon: 'dashboard', type: 'menu',
    permission: 'dashboard:view', sort: 1,
    children: [
      { menu_name: '数据刷新', type: 'button', permission: 'dashboard:refresh' },
      { menu_name: '异常预警查看', type: 'button', permission: 'dashboard:warning' },
      { menu_name: '快捷操作', type: 'button', permission: 'dashboard:quick' },
    ],
  },
  {
    menu_name: '用户管理', path: '/user', icon: 'user', type: 'menu',
    permission: 'user:list', sort: 2,
    children: [
      { menu_name: '用户列表', path: '/user/list', type: 'menu', permission: 'user:list', icon: 'user-list' },
      { menu_name: '新增用户', type: 'button', permission: 'user:add' },
      { menu_name: '编辑用户', type: 'button', permission: 'user:edit' },
      { menu_name: '删除用户', type: 'button', permission: 'user:delete' },
      { menu_name: '导出用户', type: 'button', permission: 'user:export' },
      { menu_name: '批量操作用户', type: 'button', permission: 'user:batch' },
      { menu_name: '用户详情查看', type: 'button', permission: 'user:detail' },
      { menu_name: '用户分层管理', type: 'button', permission: 'user:layer' },
      { menu_name: '流失用户预警', type: 'button', permission: 'user:loss' },
    ],
  },
  {
    menu_name: '食物管理', path: '/food', icon: 'food', type: 'menu',
    permission: 'food:list', sort: 3,
    children: [
      { menu_name: '食物列表', path: '/food/list', type: 'menu', permission: 'food:list', icon: 'food-list' },
      { menu_name: '新增食物', type: 'button', permission: 'food:add' },
      { menu_name: '编辑食物', type: 'button', permission: 'food:edit' },
      { menu_name: '删除食物', type: 'button', permission: 'food:delete' },
      { menu_name: '批量导入食物', type: 'button', permission: 'food:batchImport' },
      { menu_name: '批量删除食物', type: 'button', permission: 'food:batchDelete' },
      { menu_name: '导出食物', type: 'button', permission: 'food:export' },
      { menu_name: '食物审核', type: 'button', permission: 'food:audit' },
      { menu_name: '食物数据校验', type: 'button', permission: 'food:check' },
    ],
  },
  {
    menu_name: '食物统计', path: '/food/statistic', icon: 'statistic', type: 'menu',
    permission: 'food:statistic', sort: 4,
    children: [
      { menu_name: '分类统计查看', type: 'button', permission: 'food:statistic:category' },
      { menu_name: '热门食物排行', type: 'button', permission: 'food:statistic:hot' },
      { menu_name: '营养成分分析', type: 'button', permission: 'food:statistic:nutrition' },
    ],
  },
  {
    menu_name: '用户分析', path: '/user/analysis', icon: 'analysis', type: 'menu',
    permission: 'user:analysis', sort: 5,
    children: [
      { menu_name: '用户行为分析', type: 'button', permission: 'user:analysis:behavior' },
      { menu_name: '运营报表生成', type: 'button', permission: 'user:analysis:report' },
      { menu_name: '异常数据监控', type: 'button', permission: 'user:analysis:abnormal' },
    ],
  },
  {
    menu_name: '权限管理', path: '/permission', icon: 'permission', type: 'menu',
    permission: 'permission:view', sort: 6,
    children: [
      { menu_name: '部门管理', path: '/permission/dept', type: 'menu', permission: 'dept:list', icon: 'dept' },
      { menu_name: '角色管理', path: '/permission/role', type: 'menu', permission: 'role:list', icon: 'role' },
      { menu_name: '菜单管理', path: '/permission/menu', type: 'menu', permission: 'menu:list', icon: 'menu' },
      { menu_name: '操作日志', path: '/permission/log', type: 'menu', permission: 'log:view', icon: 'log' },
    ],
  },
  {
    menu_name: '系统设置', path: '/system', icon: 'system', type: 'menu',
    permission: 'system:view', sort: 7,
    children: [
      { menu_name: '食物分类管理', path: '/system/foodCategory', type: 'menu', permission: 'system:foodCategory', icon: 'food-category' },
      { menu_name: '系统参数配置', path: '/system/param', type: 'menu', permission: 'system:param', icon: 'param' },
      { menu_name: '数据备份恢复', path: '/system/backup', type: 'menu', permission: 'system:backup', icon: 'backup' },
    ],
  },
];

/** 各角色拥有的权限码（super_admin 全部，其他通过权限码白名单） */
export const ROLE_PERMS = {
  super_admin: '*', // 全权
  admin: [
    'dashboard:view', 'dashboard:refresh', 'dashboard:warning', 'dashboard:quick',
    'user:list', 'user:add', 'user:edit', 'user:delete', 'user:export', 'user:batch',
    'user:detail', 'user:layer', 'user:loss',
    'food:list', 'food:add', 'food:edit', 'food:delete',
    'food:batchImport', 'food:batchDelete', 'food:export', 'food:audit', 'food:check',
    'food:statistic', 'food:statistic:category', 'food:statistic:hot', 'food:statistic:nutrition',
    'user:analysis', 'user:analysis:behavior', 'user:analysis:report', 'user:analysis:abnormal',
  ],
  user: ['dashboard:view'],
  guest: [
    'dashboard:view', 'food:list', 'food:statistic',
    'food:statistic:category', 'food:statistic:hot',
  ],
};
