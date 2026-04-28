import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import path from 'path';

import healthRoutes from './routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import foodRoutes from './routes/foods.js';
import analyticsRoutes from './routes/analytics.js';
import dashboardRoutes from './routes/dashboard.js';
import sysDeptRoutes from './routes/sys/depts.js';
import sysRoleRoutes from './routes/sys/roles.js';
import sysMenuRoutes from './routes/sys/menus.js';
import sysUserRoutes from './routes/sys/sysUsers.js';
import sysLogRoutes from './routes/sys/logs.js';
import sysParamRoutes from './routes/sys/params.js';
import sysFoodCategoryRoutes from './routes/sys/foodCategories.js';
import sysBackupRoutes from './routes/sys/backup.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(morgan('dev'));

// 静态管理界面
app.use(express.static(path.join(__dirname, '../public')));

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/foods', foodRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 权限管理 / 系统设置
app.use('/api/sys/depts', sysDeptRoutes);
app.use('/api/sys/roles', sysRoleRoutes);
app.use('/api/sys/menus', sysMenuRoutes);
app.use('/api/sys/users', sysUserRoutes);
app.use('/api/sys/logs', sysLogRoutes);
app.use('/api/sys/params', sysParamRoutes);
app.use('/api/sys/food-categories', sysFoodCategoryRoutes);
app.use('/api/sys/backup', sysBackupRoutes);
app.use('/api/dept', sysDeptRoutes);
app.use('/api/menu', sysMenuRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
