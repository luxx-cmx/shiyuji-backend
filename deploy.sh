#!/bin/bash
# ============================================================
# 食愈记后台 - 阿里云部署脚本
# 目标目录: /opt/shiyujihouduan
# 使用方式: bash deploy.sh
# ============================================================

set -e

REPO="https://github.com/luxx-cmx/shiyuji-backend.git"
APP_DIR="/opt/shiyujihouduan"
SERVICE_NAME="shiyuji"
NODE_MIN_VERSION=18

echo "======================================================"
echo "  食愈记后台 - 部署开始 $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"

# ── 1. 检查 Node.js ──
echo ""
echo "[1/6] 检查 Node.js 环境..."
if ! command -v node &>/dev/null; then
  echo "  未检测到 Node.js，正在安装 (Node 20 LTS)..."
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null || \
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs 2>/dev/null || yum install -y nodejs
fi
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
echo "  Node.js 版本: $(node -v)"
if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
  echo "  ❌ Node.js 版本过低，需要 >= ${NODE_MIN_VERSION}"
  exit 1
fi

# ── 2. 检查 PM2 ──
echo ""
echo "[2/6] 检查 PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "  安装 PM2..."
  npm install -g pm2
fi
echo "  PM2 版本: $(pm2 -v)"

# ── 3. 拉取/更新代码 ──
echo ""
echo "[3/6] 同步代码..."
if [ -d "$APP_DIR/.git" ]; then
  echo "  目录已存在，执行 git pull..."
  cd "$APP_DIR"
  git pull origin main
else
  echo "  首次部署，克隆仓库..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 4. 安装依赖 ──
echo ""
echo "[4/6] 安装 npm 依赖..."
npm install --omit=dev

# ── 5. 配置 .env ──
echo ""
echo "[5/6] 检查环境配置..."
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    echo "  ⚠️  已从 .env.example 复制，请编辑 $APP_DIR/.env 填写正确配置！"
    echo "     必填项: DATABASE_URL, JWT_SECRET, PORT"
  else
    cat > "$APP_DIR/.env" <<'ENV'
# 数据库连接（必填）
DATABASE_URL=postgresql://user:password@host:5432/dbname

# JWT 密钥（必填，建议32位以上随机字符串）
JWT_SECRET=your_jwt_secret_here

# 服务端口
PORT=3000

# 运行环境
NODE_ENV=production
ENV
    echo "  ⚠️  已创建 .env 模板，请编辑 $APP_DIR/.env 填写正确配置！"
  fi
  echo ""
  read -p "  是否现在编辑 .env？(y/N): " EDIT_ENV
  if [[ "$EDIT_ENV" =~ ^[Yy]$ ]]; then
    ${EDITOR:-vi} "$APP_DIR/.env"
  fi
else
  echo "  .env 已存在，跳过"
fi

# ── 6. 启动/重启服务 ──
echo ""
echo "[6/6] 启动服务..."
cd "$APP_DIR"

# 判断是否已有 PM2 进程
if pm2 list | grep -q "$SERVICE_NAME"; then
  echo "  服务已存在，执行 reload..."
  pm2 reload "$SERVICE_NAME"
else
  echo "  首次启动..."
  pm2 start src/server.js \
    --name "$SERVICE_NAME" \
    --log /var/log/${SERVICE_NAME}.log \
    --error /var/log/${SERVICE_NAME}-error.log \
    --restart-delay 3000 \
    --max-restarts 10 \
    --env production
fi

# 保存 PM2 配置，开机自启
pm2 save
pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true

echo ""
echo "======================================================"
echo "  ✅ 部署完成！"
echo ""
echo "  服务名称  : $SERVICE_NAME"
echo "  应用目录  : $APP_DIR"
echo "  查看日志  : pm2 logs $SERVICE_NAME"
echo "  查看状态  : pm2 status"
echo "  重启服务  : pm2 restart $SERVICE_NAME"
echo "  停止服务  : pm2 stop $SERVICE_NAME"
echo "======================================================"
