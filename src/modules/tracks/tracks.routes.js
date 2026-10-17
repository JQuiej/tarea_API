const { Router } = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../../db');
const AppError = require('../../utils/AppError');
const validate = require('../../middlewares/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { paginationSchema, paginate, pageResponse } = require('../../utils/pagination');
const { TRACK_SELECT, toTrack } = require('./tracks.mapper');

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.uuid('ID inválido') });
const getTrack = db.prepare(`${TRACK_SELECT} WHERE t.id = ?`);

const listQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  artistId: z.uuid().optional(),
  albumId: z.uuid().optional(),
  sort: z.enum(['popular', 'recent', 'title']).default('popular'),
});
const SORTS = { popular: 't.play_count DESC', recent: 'al.release_date DESC', title: 't.title ASC' };

router.get('/', validate({ query: listQuery }), (req, res) => {
  const { search, artistId, albumId, sort } = req.valid.query;
  const { limit, offset } = paginate(req.valid.query);
  const conds = [];
  const args = [];
  if (search) { conds.push('(t.title LIKE ? OR ar.name LIKE ?)'); args.push(`%${search}%`, `%${search}%`); }
  if (artistId) { conds.push('ar.id = ?'); args.push(artistId); }
  if (albumId) { conds.push('al.id = ?'); args.push(albumId); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${TRACK_SELECT} ${where})`).get(...args).n;
  // El ORDER BY viene de una lista blanca (SORTS), nunca del texto del usuario.
  const rows = db.prepare(`${TRACK_SELECT} ${where} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json(pageResponse(rows.map(toTrack), total, req.valid.query));
});

router.get('/:id', validate({ params: idParam }), (req, res) => {
  const row = getTrack.get(req.valid.params.id);
  if (!row) throw AppError.notFound('Canción');
  res.json(toTrack(row));
});

// Simula la reproducción: registra historial y aplica reglas de negocio
// según el plan (los usuarios Free solo obtienen vista previa con anuncios).
router.post('/:id/play', validate({ params: idParam }), (req, res) => {
  const row = getTrack.get(req.valid.params.id);
  if (!row) throw AppError.notFound('Canción');

  db.transaction(() => {
    db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(row.id);
    db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(req.user.id, row.id);
  })();

  const isFree = req.user.plan === 'free';
  res.json({
    track: toTrack({ ...row, play_count: row.play_count + 1 }),
    playback: {
      mode: isFree ? 'preview' : 'full',
      allowedDurationMs: isFree ? Math.min(30000, row.duration_ms) : row.duration_ms,
      ads: isFree,
      quality: isFree ? '128kbps' : '320kbps',
      streamUrl: `https://cdn.soundwave.local/stream/${row.id}?q=${isFree ? 'low' : 'high'}`,
    },
  });
});

// ---------- Administración del catálogo ----------

const trackBody = z.strictObject({
  albumId: z.uuid(),
  title: z.string().trim().min(1).max(150),
  durationMs: z.number().int().min(1000).max(60 * 60 * 1000),
  trackNumber: z.number().int().min(1).max(500).default(1),
  explicit: z.boolean().default(false),
});

router.post('/', authorize('admin'), validate({ body: trackBody }), (req, res) => {
  const b = req.valid.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tracks (id, album_id, title, duration_ms, track_no, explicit) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, b.albumId, b.title, b.durationMs, b.trackNumber, b.explicit ? 1 : 0);
  res.status(201).location(`/api/v1/tracks/${id}`).json(toTrack(getTrack.get(id)));
});

const trackPatch = z.strictObject({
  title: z.string().trim().min(1).max(150).optional(),
  durationMs: z.number().int().min(1000).max(60 * 60 * 1000).optional(),
  trackNumber: z.number().int().min(1).max(500).optional(),
  explicit: z.boolean().optional(),
});

router.patch('/:id', authorize('admin'), validate({ params: idParam, body: trackPatch }), (req, res) => {
  const b = req.valid.body;
  const r = db.prepare(`UPDATE tracks SET title = COALESCE(?, title), duration_ms = COALESCE(?, duration_ms),
      track_no = COALESCE(?, track_no), explicit = COALESCE(?, explicit) WHERE id = ?`)
    .run(b.title ?? null, b.durationMs ?? null, b.trackNumber ?? null,
      b.explicit === undefined ? null : Number(b.explicit), req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Canción');
  res.json(toTrack(getTrack.get(req.valid.params.id)));
});

router.delete('/:id', authorize('admin'), validate({ params: idParam }), (req, res) => {
  const r = db.prepare('DELETE FROM tracks WHERE id = ?').run(req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Canción');
  res.status(204).end();
});

module.exports = router;
