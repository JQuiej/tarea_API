const { Router } = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../../db');
const AppError = require('../../utils/AppError');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');
const { paginationSchema, paginate, pageResponse } = require('../../utils/pagination');
const { TRACK_SELECT, toTrack } = require('../tracks/tracks.mapper');

const router = Router();
router.use(authenticate);

const FREE_PLAYLIST_LIMIT = 5;
const MAX_TRACKS_PER_PLAYLIST = 500;

const idParam = z.object({ id: z.uuid('ID inválido') });

const PLAYLIST_SELECT = `
  SELECT p.*, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
  FROM playlists p JOIN users u ON u.id = p.owner_id`;

const toPlaylist = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  isPublic: Boolean(p.is_public),
  owner: { id: p.owner_id, displayName: p.owner_name },
  totalTracks: p.track_count,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

const getPlaylist = db.prepare(`${PLAYLIST_SELECT} WHERE p.id = ?`);

// Autorización a nivel de objeto (previene BOLA/IDOR, riesgo #1 de OWASP API Top 10):
// no basta con estar autenticado, hay que ser dueño del recurso.
function loadPlaylist(req, { mustOwn }) {
  const p = getPlaylist.get(req.valid.params.id);
  const isOwner = p && p.owner_id === req.user.id;
  // Una playlist privada ajena responde 404 (no 403) para no revelar que existe.
  if (!p || (!p.is_public && !isOwner && req.user.role !== 'admin')) throw AppError.notFound('Playlist');
  if (mustOwn && !isOwner) throw AppError.forbidden('Solo el dueño puede modificar esta playlist');
  return p;
}

// Playlists públicas de toda la comunidad
const listQuery = paginationSchema.extend({ search: z.string().trim().max(100).optional() });

router.get('/', validate({ query: listQuery }), (req, res) => {
  const { search } = req.valid.query;
  const { limit, offset } = paginate(req.valid.query);
  const where = `WHERE p.is_public = 1${search ? ' AND p.name LIKE ?' : ''}`;
  const args = search ? [`%${search}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM playlists p ${where}`).get(...args).n;
  const rows = db.prepare(`${PLAYLIST_SELECT} ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json(pageResponse(rows.map(toPlaylist), total, req.valid.query));
});

// Mis playlists (públicas y privadas)
router.get('/me', validate({ query: paginationSchema }), (req, res) => {
  const { limit, offset } = paginate(req.valid.query);
  const total = db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE owner_id = ?').get(req.user.id).n;
  const rows = db.prepare(`${PLAYLIST_SELECT} WHERE p.owner_id = ? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`)
    .all(req.user.id, limit, offset);
  res.json(pageResponse(rows.map(toPlaylist), total, req.valid.query));
});

const playlistBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  isPublic: z.boolean().default(true),
});

router.post('/', validate({ body: playlistBody }), (req, res) => {
  if (req.user.plan === 'free') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE owner_id = ?').get(req.user.id).n;
    if (n >= FREE_PLAYLIST_LIMIT) {
      throw new AppError(403, 'PLAN_LIMIT', `El plan Free permite máximo ${FREE_PLAYLIST_LIMIT} playlists. Mejora a Premium.`);
    }
  }
  const b = req.valid.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO playlists (id, owner_id, name, description, is_public) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, b.name, b.description ?? null, b.isPublic ? 1 : 0);
  res.status(201).location(`/api/v1/playlists/${id}`).json(toPlaylist(getPlaylist.get(id)));
});

router.get('/:id', validate({ params: idParam }), (req, res) => {
  const p = loadPlaylist(req, { mustOwn: false });
  const tracks = db.prepare(`${TRACK_SELECT.replace('SELECT', 'SELECT pt.position, pt.added_at,')}
      JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`)
    .all(p.id)
    .map((r) => ({ position: r.position, addedAt: r.added_at, track: toTrack(r) }));
  res.json({ ...toPlaylist(p), tracks });
});

router.patch('/:id', validate({
  params: idParam,
  // Esquema propio (sin .default) para que un PATCH parcial no cambie la visibilidad.
  body: z.strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(300).optional(),
    isPublic: z.boolean().optional(),
  }).refine((o) => Object.keys(o).length > 0, 'Envía al menos un campo'),
}), (req, res) => {
  const p = loadPlaylist(req, { mustOwn: true });
  const b = req.valid.body;
  db.prepare(`UPDATE playlists SET name = COALESCE(?, name), description = COALESCE(?, description),
      is_public = COALESCE(?, is_public), updated_at = datetime('now') WHERE id = ?`)
    .run(b.name ?? null, b.description ?? null, b.isPublic === undefined ? null : Number(b.isPublic), p.id);
  res.json(toPlaylist(getPlaylist.get(p.id)));
});

router.delete('/:id', validate({ params: idParam }), (req, res) => {
  const p = loadPlaylist(req, { mustOwn: req.user.role !== 'admin' });
  db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
  res.status(204).end();
});

router.post('/:id/tracks', validate({ params: idParam, body: z.strictObject({ trackId: z.uuid() }) }), (req, res) => {
  const p = loadPlaylist(req, { mustOwn: true });
  const { trackId } = req.valid.body;
  if (!db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId)) throw AppError.notFound('Canción');
  if (p.track_count >= MAX_TRACKS_PER_PLAYLIST) throw AppError.badRequest('La playlist alcanzó el máximo de canciones');
  if (db.prepare('SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').get(p.id, trackId)) {
    throw AppError.conflict('La canción ya está en la playlist');
  }
  db.transaction(() => {
    const next = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM playlist_tracks WHERE playlist_id = ?').get(p.id).n;
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(p.id, trackId, next);
    db.prepare(`UPDATE playlists SET updated_at = datetime('now') WHERE id = ?`).run(p.id);
  })();
  res.status(201).json(toPlaylist(getPlaylist.get(p.id)));
});

router.delete('/:id/tracks/:trackId', validate({ params: idParam.extend({ trackId: z.uuid() }) }), (req, res) => {
  const p = loadPlaylist(req, { mustOwn: true });
  const r = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(p.id, req.valid.params.trackId);
  if (r.changes === 0) throw AppError.notFound('La canción en la playlist');
  db.prepare(`UPDATE playlists SET updated_at = datetime('now') WHERE id = ?`).run(p.id);
  res.status(204).end();
});

module.exports = router;
