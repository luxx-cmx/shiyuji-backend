# 食愈记管理后端

基于 Node.js + Express + PostgreSQL，聚焦：
- 用户管理与数据分析
- 食物库管理与前端数据供给

## 1. 环境变量

已按你的配置写入 `.env`：
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `JWT_SECRET`
- `DATABASE_URL`

## 2. 安装依赖

```bash
npm install
```

## 3. 启动服务

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

## 4. 首次启动会自动完成

- `ensureSchema()`：自动建表（幂等）
- `seedFoods()`：食物库静态数据初始化（幂等）
- 初始化管理员账号（默认）：`admin / Admin@123456`

可通过环境变量覆盖管理员：
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

## 5. 核心接口

### 健康检查
- `GET /health`

### 管理员登录
- `POST /api/auth/admin/login`

### 用户管理（需管理员 JWT）
- `GET /api/users`
- `PATCH /api/users/:id/status`
- `GET /api/users/export/csv`

### 食物库
- 前端可直接使用（无需管理员 JWT）：
  - `GET /api/foods`
  - `GET /api/foods/categories`
  - `GET /api/foods/:id`
- 后台管理（需管理员 JWT）：
  - `POST /api/foods`
  - `POST /api/foods/batch`
  - `PUT /api/foods/:id`
  - `DELETE /api/foods/:id`
  - `POST /api/foods/batch-delete`
  - `GET /api/foods/export/csv`

### 数据分析（需管理员 JWT）
- `GET /api/dashboard/overview`
- `GET /api/analytics/users/new?dimension=day|week|month`
- `GET /api/analytics/users/active`
- `GET /api/analytics/users/targets`
- `GET /api/analytics/foods/overview`
- `GET /api/analytics/foods/popular-favorites`
