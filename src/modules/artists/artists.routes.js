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

const toArtist = (a) => ({
  id: a.id,
  name: a.name,
  genre: a.genre,
  country: a.country,
  bio: a.bio,
  monthlyListeners: a.monthly_listeners,
});

const getArtist = db.prepare('SELECT * FROM artists WHERE id = ?');

const listQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  genre: z.string().trim().max(50).optional(),
});

router.get('/', validate({ query: listQuery }), (req, res) => {
  const { search, genre } = req.valid.query;
  const { limit, offset } = paginate(req.valid.query);
  const conds = [];
  const args = [];
  if (search) { conds.push('name LIKE ?'); args.push(`%${search}%`); }
  if (genre) { conds.push('genre = ? COLLATE NOCASE'); args.push(genre); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM artists ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM artists ${where} ORDER BY monthly_listeners DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
  res.json(pageResponse(rows.map(toArtist), total, req.valid.query));
});

router.get('/:id', validate({ params: idParam }), (req, res) => {
  const artist = getArtist.get(req.valid.params.id);
  if (!artist) throw AppError.notFound('Artista');
  const albums = db.prepare('SELECT id, title, release_date, album_type FROM albums WHERE artist_id = ? ORDER BY release_date DESC')
    .all(artist.id)
    .map((a) => ({ id: a.id, title: a.title, releaseDate: a.release_date, type: a.album_type }));
  res.json({ ...toArtist(artist), albums });
});

router.get('/:id/top-tracks', validate({ params: idParam }), (req, res) => {
  if (!getArtist.get(req.valid.params.id)) throw AppError.notFound('Artista');
  const rows = db.prepare(`${TRACK_SELECT} WHERE ar.id = ? ORDER BY t.play_count DESC LIMIT 10`).all(req.valid.params.id);
  res.json({ data: rows.map(toTrack) });
});

// ---------- Administración del catálogo ----------

const artistBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  genre: z.string().trim().min(1).max(50),
  country: z.string().length(2).toUpperCase().optional(),
  bio: z.string().trim().max(1000).optional(),
});

router.post('/', authorize('admin'), validate({ body: artistBody }), (req, res) => {
  const b = req.valid.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO artists (id, name, genre, country, bio) VALUES (?, ?, ?, ?, ?)')
    .run(id, b.name, b.genre, b.country ?? null, b.bio ?? null);
  res.status(201).location(`/api/v1/artists/${id}`).json(toArtist(getArtist.get(id)));
});

router.patch('/:id', authorize('admin'), validate({ params: idParam, body: artistBody.partial() }), (req, res) => {
  const b = req.valid.body;
  const r = db.prepare(`UPDATE artists SET name = COALESCE(?, name), genre = COALESCE(?, genre),
      country = COALESCE(?, country), bio = COALESCE(?, bio) WHERE id = ?`)
    .run(b.name ?? null, b.genre ?? null, b.country ?? null, b.bio ?? null, req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Artista');
  res.json(toArtist(getArtist.get(req.valid.params.id)));
});

router.delete('/:id', authorize('admin'), validate({ params: idParam }), (req, res) => {
  const r = db.prepare('DELETE FROM artists WHERE id = ?').run(req.valid.params.id);
  if (r.changes === 0) throw AppError.notFound('Artista');
  res.status(204).end();
});

module.exports = router;
