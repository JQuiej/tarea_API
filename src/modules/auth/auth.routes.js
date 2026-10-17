const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');
const schemas = require('./auth.schemas');
const service = require('./auth.service');
const config = require('../../config');

const router = Router();

// Límite estricto en login/registro contra fuerza bruta y relleno de credenciales.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos, espera 15 minutos' } },
});

router.post('/register', authLimiter, validate({ body: schemas.register }), async (req, res) => {
  const { user, tokens } = await service.register(req.valid.body);
  res.status(201).json({ user, ...tokens });
});

router.post('/login', authLimiter, validate({ body: schemas.login }), async (req, res) => {
  const { user, tokens } = await service.login(req.valid.body);
  res.json({ user, ...tokens });
});

router.post('/refresh', validate({ body: schemas.refresh }), (req, res) => {
  const { tokens } = service.refresh(req.valid.body.refreshToken);
  res.json(tokens);
});

router.post('/logout', validate({ body: schemas.refresh }), (req, res) => {
  service.logout(req.valid.body.refreshToken);
  res.status(204).end();
});

router.post('/logout-all', authenticate, (req, res) => {
  service.logoutAll(req.user.id);
  res.status(204).end();
});

router.put('/password', authenticate, validate({ body: schemas.changePassword }), async (req, res) => {
  await service.changePassword(req.user.id, req.valid.body);
  res.status(204).end();
});

module.exports = router;
