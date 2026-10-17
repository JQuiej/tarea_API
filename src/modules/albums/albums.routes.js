const { Router } = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../../db');
const AppError = require('../../utils/AppError');
const validate = require('../../middlewares/validate');
const { authenticate, authorize } = require('../../middlewares/auth');
const { paginationSchema, paginate, pageResponse } = require('../../utils/pagination');
const { TRACK_SELECT, toTrack } = require('../tracks/tracks.mapper');

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.uuid('ID inválido') });

const ALBUM_SELECT = `SELECT al.*, ar.name AS artist_name FROM albums al JOIN artists ar ON ar.id = al.artist_id`;
const toAlbum = (a) => ({
  id: a.id,
  title: a.title,
  releaseDate: a.release_date,
  type: a.album_type,
  coverUrl: a.cover_url,
  artist: { id: a.artist_id, name: a.artist_name },
});
const getAlbum = db.prepare(`${ALBUM_SELECT} WHERE al.id = ?`);

const listQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  artistId: z.uuid().optional(),
});

router.get('/', validate({ query: listQuery }), (req, res) => {
  const { search, artistId } = req.valid.query;
  const { limit, offset } = paginate(req.valid.query);
  const conds = [];
  const args = [];
  if (search) { conds.push('al.title LIKE ?'); args.push(`%${search}%`); }
  if (artistId) { conds.push('al.artist_id = ?'); args.push(artistId); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM albums al ${where}`).get(...args).n;
  const rows = db.prepare(`${ALBUM_SELECT} ${where} ORDER BY al.release_date DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  res.json(pageResponse(rows.map(toAlbum), total, req.valid.query));
});

router.get('/:id', validate({ params: idParam }), (req, res) => {
  const album = getAlbum.get(req.valid.params.id);
  if (!album) throw AppError.notFound('Álbum');
  const tracks = db.prepare(`${TRACK_SELECT} WHERE al.id = ? ORDER BY t.track_no`).all(album.id).map(toTrack);
  res.json({ ...toAlbum(album), totalTracks: tracks.length, tracks });
});

// ---------- Administración del catálogo ----------

const albumBody = z.strictObject({
  artistId: z.uuid(),
  title: z.string().trim().min(1).max(150),
  releaseDate: z.iso.date('Formato YYYY-MM-DD'),
  type: z.enum(['album', 'single', 'ep']).default('album'),
  coverUrl: z.url({ protocol: /^https$/ }).optional(),
});

router.post('/', authorize('admin'), validate({ body: albumBody }), (req, res) => {
  const b = req.valid.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO albums (id, artist_id, title, release_date, album_type, cover_url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, b.artistId, b.title, b.releaseDate, b.type, b.coverUrl ?? null);
  res.status(201).location(`/api/v1/albums/${id}`).json(toAlbum(getAlbum.get(id)));
});

router.patch('/:id', authorize('admin'), validate({
  params: idParam,
  body: z.strictObject({
    title: z.string().trim().min(1).max(150).optional(),
    releaseDate: z.iso.date('Formato YYYY-MM-DD').optional(),
    type: z.enum(['album', 'single', 'ep']).optional(),
    coverUrl: z.url({ protocol: /^https$/ }).optional(),
  }),
}), (req, res) => {
  const b = req.valid.body;
  const r = db.prepare(`UPDATE albums SET title = COALESCE(?, title), release_date = COALESCE(?, release_date),
      album_type = COALESCE(?, album_type), cover_url = COALESCE(?, cover_url) WHERE id = ?`)
    .run(b.title ?? null, b.releaseDate ?? null, b.type ?? null, b.coverUrl ?? null, req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Álbum');
  res.json(toAlbum(getAlbum.get(req.valid.params.id)));
});

router.delete('/:id', authorize('admin'), validate({ params: idParam }), (req, res) => {
  const r = db.prepare('DELETE FROM albums WHERE id = ?').run(req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Álbum');
  res.status(204).end();
});

module.exports = router;
