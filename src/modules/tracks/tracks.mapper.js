// SELECT base de canciones con su álbum y artista, reutilizado por varios módulos.
const TRACK_SELECT = `
  SELECT t.id, t.title, t.duration_ms, t.track_no, t.explicit, t.play_count,
         al.id AS album_id, al.title AS album_title, al.release_date,
         ar.id AS artist_id, ar.name AS artist_name
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
  JOIN artists ar ON ar.id = al.artist_id`;

function toTrack(r) {
  return {
    id: r.id,
    title: r.title,
    durationMs: r.duration_ms,
    trackNumber: r.track_no,
    explicit: Boolean(r.explicit),
    playCount: r.play_count,
    album: { id: r.album_id, title: r.album_title, releaseDate: r.release_date },
    artist: { id: r.artist_id, name: r.artist_name },
  };
}

module.exports = { TRACK_SELECT, toTrack };
