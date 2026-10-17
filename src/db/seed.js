// Datos de demostración. Se ejecuta automáticamente si la BD está vacía,
// o manualmente con: npm run seed
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');

const catalog = [
  {
    name: 'Luna Quetzal', genre: 'Pop latino', country: 'GT', monthly_listeners: 1250000,
    bio: 'Cantautora guatemalteca que mezcla pop con marimba.',
    albums: [
      { title: 'Cielo de Volcanes', release_date: '2024-03-15', album_type: 'album',
        tracks: [['Antigua al amanecer', 214000], ['Marimba eléctrica', 198000], ['Lago de Atitlán', 241000], ['Volcán de Fuego', 187000]] },
      { title: 'Lluvia de Mayo', release_date: '2025-05-01', album_type: 'single',
        tracks: [['Lluvia de Mayo', 203000]] },
    ],
  },
  {
    name: 'Los Códigos', genre: 'Rock alternativo', country: 'MX', monthly_listeners: 830000,
    bio: 'Banda de rock formada por ingenieros de software.',
    albums: [
      { title: 'Stack Overflow', release_date: '2023-09-22', album_type: 'album',
        tracks: [['Null Pointer', 225000, 1], ['Merge Conflict', 256000], ['404 Corazón', 233000], ['Deploy en Viernes', 278000, 1]] },
    ],
  },
  {
    name: 'DJ Cifrado', genre: 'Electrónica', country: 'ES', monthly_listeners: 2100000,
    bio: 'Productor de música electrónica inspirado en la criptografía.',
    albums: [
      { title: 'Hash & Salt', release_date: '2025-01-10', album_type: 'ep',
        tracks: [['SHA-256', 301000], ['Bcrypt Rounds', 287000], ['Token Expirado', 264000]] },
    ],
  },
  {
    name: 'Orquesta Firewall', genre: 'Clásica', country: 'AR', monthly_listeners: 410000,
    bio: 'Orquesta de cámara que reinterpreta clásicos.',
    albums: [
      { title: 'Sinfonía del Puerto 443', release_date: '2022-11-30', album_type: 'album',
        tracks: [['I. Handshake', 412000], ['II. Certificado', 389000], ['III. Cifrado Simétrico', 455000]] },
    ],
  },
];

function seed({ force = false } = {}) {
  const hasData = db.prepare('SELECT COUNT(*) AS n FROM artists').get().n > 0;
  if (hasData && !force) return false;

  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, display_name, country, role, plan_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertArtist = db.prepare(`INSERT INTO artists (id, name, genre, country, bio, monthly_listeners)
    VALUES (@id, @name, @genre, @country, @bio, @monthly_listeners)`);
  const insertAlbum = db.prepare(`INSERT INTO albums (id, artist_id, title, release_date, album_type)
    VALUES (?, ?, ?, ?, ?)`);
  const insertTrack = db.prepare(`INSERT INTO tracks (id, album_id, title, duration_ms, track_no, explicit, play_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    if (force) {
      db.exec('DELETE FROM artists');
    }
    insertUser.run(randomUUID(), config.seedAdmin.email, bcrypt.hashSync(config.seedAdmin.password, config.bcryptRounds),
      'Administrador', 'GT', 'admin', 'premium');
    insertUser.run(randomUUID(), 'demo@soundwave.local', bcrypt.hashSync('Demo#2026Seguro', config.bcryptRounds),
      'Usuario Demo', 'GT', 'user', 'free');

    for (const artist of catalog) {
      const artistId = randomUUID();
      insertArtist.run({ id: artistId, name: artist.name, genre: artist.genre, country: artist.country,
        bio: artist.bio, monthly_listeners: artist.monthly_listeners });
      for (const album of artist.albums) {
        const albumId = randomUUID();
        insertAlbum.run(albumId, artistId, album.title, album.release_date, album.album_type);
        album.tracks.forEach(([title, duration, explicit = 0], i) => {
          insertTrack.run(randomUUID(), albumId, title, duration, i + 1, explicit, Math.floor(Math.random() * 500000));
        });
      }
    }
  })();
  return true;
}

module.exports = seed;

if (require.main === module) {
  seed({ force: true });
  console.log('✅ Base de datos poblada con datos de demostración.');
}
