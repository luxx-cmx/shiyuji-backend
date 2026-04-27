import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    service: 'shiyuji-backend',
    status: 'ok',
    time: new Date().toISOString(),
  });
});

export default router;
