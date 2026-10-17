const { Router } = require('express');
const { z } = require('zod');
const db = require('../../db');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');
const { TRACK_SELECT, toTrack } = require('../tracks/tracks.mapper');

const router = Router();
router.use(authenticate);

const TYPES = ['track', 'artist', 'album', 'playlist'];

const searchQuery = z.object({
  q: z.string().trim().min(1, 'Escribe algo para buscar').max(100),
  type: z.string().default(TYPES.join(','))
    .transform((s) => s.split(',').map((t) => t.trim()))
    .pipe(z.array(z.enum(TYPES)).min(1)),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

// Búsqueda global estilo Spotify: GET /api/v1/search?q=luna&type=track,artist
router.get('/', validate({ query: searchQuery }), (req, res) => {
  const { q, type, limit } = req.valid.query;
  const like = `%${q}%`;
  const result = {};

  if (type.includes('track')) {
    result.tracks = db.prepare(`${TRACK_SELECT} WHERE t.title LIKE ? ORDER BY t.play_count DESC LIMIT ?`)
      .all(like, limit).map(toTrack);
  }
  if (type.includes('artist')) {
    result.artists = db.prepare('SELECT id, name, genre FROM artists WHERE name LIKE ? ORDER BY monthly_listeners DESC LIMIT ?')
      .all(like, limit);
  }
  if (type.includes('album')) {
    result.albums = db.prepare(`SELECT al.id, al.title, al.release_date AS releaseDate, ar.name AS artistName
      FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.title LIKE ? LIMIT ?`).all(like, limit);
  }
  if (type.includes('playlist')) {
    result.playlists = db.prepare(`SELECT id, name, description FROM playlists
      WHERE is_public = 1 AND name LIKE ? LIMIT ?`).all(like, limit);
  }
  res.json(result);
});

module.exports = router;
