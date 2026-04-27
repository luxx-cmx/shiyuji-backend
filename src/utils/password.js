import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/** 生成 bcrypt 哈希（推荐用于新建/重置密码） */
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/** 兼容 sha256（旧 admin_users 数据）与 bcrypt 两种校验 */
export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  if (passwordHash.startsWith('$2')) {
    return bcrypt.compare(password, passwordHash);
  }
  const sha = crypto.createHash('sha256').update(password).digest('hex');
  return sha === passwordHash;
}

/** 同步生成（仅用于种子数据） */
export function hashPasswordSync(password) {
  return bcrypt.hashSync(password, 10);
}

/** sha256 哈希（兼容旧表 admin_users 写入） */
export function sha256(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}
