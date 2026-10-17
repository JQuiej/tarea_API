const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../../db');
const AppError = require('../../utils/AppError');
const validate = require('../../middlewares/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { paginationSchema, paginate, pageResponse } = require('../../utils/pagination');
const { TRACK_SELECT, toTrack } = require('../tracks/tracks.mapper');
const { toPublicUser } = require('./users.mapper');

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.uuid('ID inválido') });
const trackIdParam = z.object({ trackId: z.uuid('ID inválido') });

const q = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  trackExists: db.prepare('SELECT 1 FROM tracks WHERE id = ?'),
  like: db.prepare('INSERT OR IGNORE INTO liked_tracks (user_id, track_id) VALUES (?, ?)'),
  unlike: db.prepare('DELETE FROM liked_tracks WHERE user_id = ? AND track_id = ?'),
  likedCount: db.prepare('SELECT COUNT(*) AS n FROM liked_tracks WHERE user_id = ?'),
  liked: db.prepare(`${TRACK_SELECT} JOIN liked_tracks lt ON lt.track_id = t.id
    WHERE lt.user_id = ? ORDER BY lt.liked_at DESC LIMIT ? OFFSET ?`),
  historyCount: db.prepare('SELECT COUNT(*) AS n FROM play_history WHERE user_id = ?'),
  history: db.prepare(`${TRACK_SELECT.replace('SELECT', 'SELECT h.played_at,')} JOIN play_history h ON h.track_id = t.id
    WHERE h.user_id = ? ORDER BY h.id DESC LIMIT ? OFFSET ?`),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
};

// ---------- Perfil propio ----------

router.get('/me', (req, res) => {
  res.json(toPublicUser(q.byId.get(req.user.id)));
});

const updateMe = z.strictObject({
  displayName: z.string().trim().min(2).max(50).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  birthDate: z.iso.date().optional(),
}).refine((o) => Object.keys(o).length > 0, 'Envía al menos un campo');

router.patch('/me', validate({ body: updateMe }), (req, res) => {
  const b = req.valid.body;
  db.prepare(`UPDATE users SET
      display_name = COALESCE(?, display_name),
      country = COALESCE(?, country),
      birth_date = COALESCE(?, birth_date),
      updated_at = datetime('now')
    WHERE id = ?`).run(b.displayName ?? null, b.country ?? null, b.birthDate ?? null, req.user.id);
  res.json(toPublicUser(q.byId.get(req.user.id)));
});

// Eliminar la cuenta exige re-confirmar la contraseña (acción destructiva).
router.delete('/me', validate({ body: z.strictObject({ password: z.string().min(1).max(72) }) }), async (req, res) => {
  const user = q.byId.get(req.user.id);
  if (!(await bcrypt.compare(req.valid.body.password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Contraseña incorrecta');
  }
  q.deleteUser.run(user.id);
  res.status(204).end();
});

// ---------- Canciones que me gustan ----------

router.get('/me/liked-tracks', validate({ query: paginationSchema }), (req, res) => {
  const { limit, offset } = paginate(req.valid.query);
  const rows = q.liked.all(req.user.id, limit, offset);
  res.json(pageResponse(rows.map(toTrack), q.likedCount.get(req.user.id).n, req.valid.query));
});

router.put('/me/liked-tracks/:trackId', validate({ params: trackIdParam }), (req, res) => {
  if (!q.trackExists.get(req.valid.params.trackId)) throw AppError.notFound('Canción');
  q.like.run(req.user.id, req.valid.params.trackId);
  res.status(204).end();
});

router.delete('/me/liked-tracks/:trackId', validate({ params: trackIdParam }), (req, res) => {
  q.unlike.run(req.user.id, req.valid.params.trackId);
  res.status(204).end();
});

// ---------- Historial de reproducción ----------

router.get('/me/history', validate({ query: paginationSchema }), (req, res) => {
  const { limit, offset } = paginate(req.valid.query);
  const rows = q.history.all(req.user.id, limit, offset);
  const items = rows.map((r) => ({ playedAt: r.played_at, track: toTrack(r) }));
  res.json(pageResponse(items, q.historyCount.get(req.user.id).n, req.valid.query));
});

// ---------- Administración (solo rol admin) ----------

const listUsersQuery = paginationSchema.extend({ search: z.string().trim().max(100).optional() });

router.get('/', authorize('admin'), validate({ query: listUsersQuery }), (req, res) => {
  const { search } = req.valid.query;
  const { limit, offset } = paginate(req.valid.query);
  const where = search ? 'WHERE email LIKE ? OR display_name LIKE ?' : '';
  const args = search ? [`%${search}%`, `%${search}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json(pageResponse(rows.map(toPublicUser), total, req.valid.query));
});

router.get('/:id', authorize('admin'), validate({ params: idParam }), (req, res) => {
  const user = q.byId.get(req.valid.params.id);
  if (!user) throw AppError.notFound('Usuario');
  res.json(toPublicUser(user));
});

router.patch('/:id/role', authorize('admin'), validate({
  params: idParam,
  body: z.strictObject({ role: z.enum(['user', 'admin']) }),
}), (req, res) => {
  const { id } = req.valid.params;
  if (id === req.user.id) throw AppError.badRequest('No puedes cambiar tu propio rol');
  // Al cambiar el rol se incrementa token_version: los tokens viejos con el rol
  // anterior dejan de ser válidos inmediatamente.
  const r = db.prepare(`UPDATE users SET role = ?, token_version = token_version + 1, updated_at = datetime('now')
    WHERE id = ?`).run(req.valid.body.role, id);
  if (r.changes === 0) throw AppError.notFound('Usuario');
  res.json(toPublicUser(q.byId.get(id)));
});

router.delete('/:id', authorize('admin'), validate({ params: idParam }), (req, res) => {
  if (req.valid.params.id === req.user.id) throw AppError.badRequest('Usa DELETE /users/me para eliminar tu cuenta');
  const r = q.deleteUser.run(req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Usuario');
  res.status(204).end();
});

module.exports = router;
