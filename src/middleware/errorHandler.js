export function notFoundHandler(req, res) {
  return res.status(404).json({ message: '接口不存在' });
}

export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || '服务器内部错误';
  return res.status(status).json({ message });
}
