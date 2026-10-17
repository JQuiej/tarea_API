const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Los identificadores son UUID (no autoincrementales) para que un atacante
// no pueda adivinar/enumerar recursos ajenos cambiando /1, /2, /3...
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    price_usd   REAL NOT NULL,
    max_members INTEGER NOT NULL DEFAULT 1,
    features    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    country       TEXT NOT NULL DEFAULT 'GT',
    birth_date    TEXT,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    plan_id       TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,           -- jti del refresh token
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id   TEXT NOT NULL,              -- cadena de rotación
    token_hash  TEXT NOT NULL,              -- nunca se guarda el token en claro
    expires_at  TEXT NOT NULL,
    revoked_at  TEXT,
    replaced_by TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family_id);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id    TEXT NOT NULL REFERENCES plans(id),
    status     TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS artists (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    genre             TEXT NOT NULL,
    country           TEXT,
    bio               TEXT,
    monthly_listeners INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS albums (
    id           TEXT PRIMARY KEY,
    artist_id    TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    release_date TEXT NOT NULL,
    album_type   TEXT NOT NULL DEFAULT 'album' CHECK (album_type IN ('album', 'single', 'ep')),
    cover_url    TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id          TEXT PRIMARY KEY,
    album_id    TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    track_no    INTEGER NOT NULL DEFAULT 1,
    explicit    INTEGER NOT NULL DEFAULT 0,
    play_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    is_public   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS liked_tracks (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    liked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS play_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id  TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_history_user ON play_history(user_id, played_at);
`);

// Los planes son datos de referencia: se garantizan en cada arranque.
const upsertPlan = db.prepare(`
  INSERT INTO plans (id, name, price_usd, max_members, features)
  VALUES (@id, @name, @price_usd, @max_members, @features)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, price_usd = excluded.price_usd,
    max_members = excluded.max_members, features = excluded.features
`);
const plans = [
  { id: 'free', name: 'Free', price_usd: 0, max_members: 1, features: 'Reproducción aleatoria, anuncios, vista previa de 30 s' },
  { id: 'student', name: 'Premium Estudiante', price_usd: 5.99, max_members: 1, features: 'Sin anuncios, reproducción completa, descargas' },
  { id: 'premium', name: 'Premium Individual', price_usd: 10.99, max_members: 1, features: 'Sin anuncios, reproducción completa, descargas, alta calidad' },
  { id: 'family', name: 'Premium Familiar', price_usd: 16.99, max_members: 6, features: 'Hasta 6 cuentas Premium, control parental' },
];
db.transaction(() => plans.forEach((p) => upsertPlan.run(p)))();

module.exports = db;
