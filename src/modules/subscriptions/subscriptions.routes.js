const { Router } = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../../db');
const AppError = require('../../utils/AppError');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');

const router = Router();

const toPlan = (p) => ({
  id: p.id,
  name: p.name,
  priceUsd: p.price_usd,
  maxMembers: p.max_members,
  features: p.features,
});

// Endpoint público: el catálogo de planes se puede consultar sin iniciar sesión.
router.get('/plans', (req, res) => {
  res.json({ data: db.prepare('SELECT * FROM plans ORDER BY price_usd').all().map(toPlan) });
});

router.use(authenticate);

const activeSub = db.prepare(`SELECT s.*, p.name AS plan_name, p.price_usd FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? AND s.status = 'active'`);

const toSubscription = (s) => s && ({
  id: s.id,
  plan: { id: s.plan_id, name: s.plan_name, priceUsd: s.price_usd },
  status: s.status,
  startedAt: s.started_at,
  renewsAt: s.ends_at,
});

router.get('/me', (req, res) => {
  const sub = activeSub.get(req.user.id);
  res.json({ plan: req.user.plan, subscription: toSubscription(sub) ?? null });
});

// Pago simulado. Buena práctica: la API NUNCA recibe números de tarjeta;
// el frontend tokeniza la tarjeta con la pasarela (Stripe, etc.) y aquí solo
// llega un token opaco como "tok_visa".
const subscribeBody = z.strictObject({
  planId: z.enum(['student', 'premium', 'family']),
  paymentToken: z.string().regex(/^tok_[A-Za-z0-9_]{3,64}$/, 'Debe ser un token de la pasarela de pago, ej. tok_visa'),
});

router.post('/', validate({ body: subscribeBody }), (req, res) => {
  const { planId } = req.valid.body;
  if (req.user.plan === planId) throw AppError.conflict('Ya tienes ese plan activo');

  const id = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'`).run(req.user.id);
    db.prepare(`INSERT INTO subscriptions (id, user_id, plan_id, status, ends_at)
      VALUES (?, ?, ?, 'active', datetime('now', '+1 month'))`).run(id, req.user.id, planId);
    db.prepare(`UPDATE users SET plan_id = ?, updated_at = datetime('now') WHERE id = ?`).run(planId, req.user.id);
  })();
  res.status(201).json({ plan: planId, subscription: toSubscription(activeSub.get(req.user.id)) });
});

router.delete('/me', (req, res) => {
  const sub = activeSub.get(req.user.id);
  if (!sub) throw AppError.notFound('Suscripción activa');
  db.transaction(() => {
    db.prepare(`UPDATE subscriptions SET status = 'canceled' WHERE id = ?`).run(sub.id);
    db.prepare(`UPDATE users SET plan_id = 'free', updated_at = datetime('now') WHERE id = ?`).run(req.user.id);
  })();
  res.status(204).end();
});

module.exports = router;
