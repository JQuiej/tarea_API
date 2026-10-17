// Pruebas de extremo a extremo. Usan una base de datos en memoria.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.BCRYPT_ROUNDS = '10';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-abcdefghij';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789-abcdefghij';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const seed = require('../src/db/seed');
const app = require('../src/app');

const api = request(app);
const auth = (token) => ({ Authorization: `Bearer ${token}` });

let admin; let alice; let bob; let trackId;

before(async () => {
  seed();
  admin = (await api.post('/api/v1/auth/login').send({ email: 'admin@soundwave.local', password: 'Admin#2026Seguro' })).body;
  alice = (await api.post('/api/v1/auth/register').send({ email: 'alice@test.com', password: 'Alice#Segura1', displayName: 'Alice' })).body;
  bob = (await api.post('/api/v1/auth/register').send({ email: 'bob@test.com', password: 'Bob#Seguro123', displayName: 'Bob' })).body;
  trackId = (await api.get('/api/v1/tracks').set(auth(alice.accessToken))).body.data[0].id;
});

// ---------- Autenticación ----------

test('registro devuelve usuario y tokens, sin exponer el hash', () => {
  assert.ok(alice.accessToken && alice.refreshToken);
  assert.equal(alice.user.plan, 'free');
  assert.equal(alice.user.role, 'user');
  assert.equal(alice.user.password_hash, undefined);
});

test('registro rechaza contraseña débil', async () => {
  const res = await api.post('/api/v1/auth/register').send({ email: 'x@test.com', password: '123456', displayName: 'X' });
  assert.equal(res.status, 400);
  assert.ok(res.body.error.details.length > 0);
});

test('registro rechaza campos extra (mass assignment: role=admin)', async () => {
  const res = await api.post('/api/v1/auth/register')
    .send({ email: 'hacker@test.com', password: 'Hacker#12345', displayName: 'H', role: 'admin' });
  assert.equal(res.status, 400);
});

test('registro con correo duplicado → 409', async () => {
  const res = await api.post('/api/v1/auth/register').send({ email: 'ALICE@test.com', password: 'Alice#Segura1', displayName: 'A2' });
  assert.equal(res.status, 409);
});

test('login con contraseña incorrecta → 401 con mensaje genérico', async () => {
  const res = await api.post('/api/v1/auth/login').send({ email: 'alice@test.com', password: 'incorrecta' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.message, 'Correo o contraseña incorrectos');
});

test('rutas protegidas sin token → 401', async () => {
  const res = await api.get('/api/v1/users/me');
  assert.equal(res.status, 401);
});

test('token con firma falsa o algoritmo "none" → 401', async () => {
  const forged = jwt.sign({ role: 'admin', type: 'access', ver: 0 }, 'otro-secreto', { subject: alice.user.id });
  assert.equal((await api.get('/api/v1/users/me').set(auth(forged))).status, 401);

  const none = jwt.sign({ role: 'admin', type: 'access', ver: 0 }, null, { algorithm: 'none', subject: alice.user.id });
  assert.equal((await api.get('/api/v1/users/me').set(auth(none))).status, 401);
});

test('refresh token no sirve como access token', async () => {
  const res = await api.get('/api/v1/users/me').set(auth(alice.refreshToken));
  assert.equal(res.status, 401);
});

test('refresh rota tokens y detecta reutilización', async () => {
  const login = (await api.post('/api/v1/auth/login').send({ email: 'bob@test.com', password: 'Bob#Seguro123' })).body;
  const r1 = await api.post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, login.refreshToken);

  // Reusar el refresh viejo (simula robo) → se revoca toda la familia
  const reuse = await api.post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error.code, 'REFRESH_REUSED');
  const after = await api.post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
  assert.equal(after.status, 401);
});

test('logout revoca el refresh token', async () => {
  const login = (await api.post('/api/v1/auth/login').send({ email: 'bob@test.com', password: 'Bob#Seguro123' })).body;
  assert.equal((await api.post('/api/v1/auth/logout').send({ refreshToken: login.refreshToken })).status, 204);
  assert.equal((await api.post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken })).status, 401);
});

// ---------- Autorización ----------

test('usuario normal no puede usar endpoints de admin → 403', async () => {
  assert.equal((await api.get('/api/v1/users').set(auth(alice.accessToken))).status, 403);
  const res = await api.post('/api/v1/artists').set(auth(alice.accessToken)).send({ name: 'X', genre: 'Y' });
  assert.equal(res.status, 403);
});

test('admin puede crear artista, álbum y canción', async () => {
  const artist = await api.post('/api/v1/artists').set(auth(admin.accessToken)).send({ name: 'Test Band', genre: 'Rock', country: 'gt' });
  assert.equal(artist.status, 201);
  assert.equal(artist.body.country, 'GT');
  const album = await api.post('/api/v1/albums').set(auth(admin.accessToken))
    .send({ artistId: artist.body.id, title: 'Primer Disco', releaseDate: '2026-01-01' });
  assert.equal(album.status, 201);
  const track = await api.post('/api/v1/tracks').set(auth(admin.accessToken))
    .send({ albumId: album.body.id, title: 'Canción 1', durationMs: 180000 });
  assert.equal(track.status, 201);
  assert.equal(track.body.artist.name, 'Test Band');
});

test('IDs inválidos o inexistentes → 400 / 404', async () => {
  assert.equal((await api.get('/api/v1/tracks/1').set(auth(alice.accessToken))).status, 400);
  assert.equal((await api.get('/api/v1/tracks/00000000-0000-4000-8000-000000000000').set(auth(alice.accessToken))).status, 404);
});

// ---------- Catálogo ----------

test('listado paginado y búsqueda', async () => {
  const res = await api.get('/api/v1/tracks?limit=2&page=1').set(auth(alice.accessToken));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 2);
  assert.ok(res.body.pagination.total > 2);

  const s = await api.get('/api/v1/search?q=luna&type=artist').set(auth(alice.accessToken));
  assert.equal(s.body.artists[0].name, 'Luna Quetzal');
  assert.equal(s.body.tracks, undefined);
});

test('inyección SQL en búsqueda no rompe ni filtra datos', async () => {
  const res = await api.get(`/api/v1/tracks?search=${encodeURIComponent("' OR 1=1 --")}`).set(auth(alice.accessToken));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 0);
});

test('reproducir: Free obtiene vista previa, Premium completa', async () => {
  const free = await api.post(`/api/v1/tracks/${trackId}/play`).set(auth(alice.accessToken));
  assert.equal(free.body.playback.mode, 'preview');
  assert.equal(free.body.playback.ads, true);

  const premium = await api.post(`/api/v1/tracks/${trackId}/play`).set(auth(admin.accessToken));
  assert.equal(premium.body.playback.mode, 'full');

  const history = await api.get('/api/v1/users/me/history').set(auth(alice.accessToken));
  assert.equal(history.body.data[0].track.id, trackId);
});

test('me gusta / quitar me gusta', async () => {
  assert.equal((await api.put(`/api/v1/users/me/liked-tracks/${trackId}`).set(auth(alice.accessToken))).status, 204);
  const liked = await api.get('/api/v1/users/me/liked-tracks').set(auth(alice.accessToken));
  assert.equal(liked.body.pagination.total, 1);
  assert.equal((await api.delete(`/api/v1/users/me/liked-tracks/${trackId}`).set(auth(alice.accessToken))).status, 204);
});

// ---------- Playlists y BOLA ----------

test('playlists: el dueño administra, otros no (BOLA)', async () => {
  const pl = await api.post('/api/v1/playlists').set(auth(alice.accessToken)).send({ name: 'Privada', isPublic: false });
  assert.equal(pl.status, 201);
  const id = pl.body.id;

  assert.equal((await api.post(`/api/v1/playlists/${id}/tracks`).set(auth(alice.accessToken)).send({ trackId })).status, 201);
  assert.equal((await api.post(`/api/v1/playlists/${id}/tracks`).set(auth(alice.accessToken)).send({ trackId })).status, 409);

  // Bob no puede ver una playlist privada de Alice (404 para no revelar que existe)
  assert.equal((await api.get(`/api/v1/playlists/${id}`).set(auth(bob.accessToken))).status, 404);

  // Si se vuelve pública, Bob la ve pero no la puede modificar
  const patched = await api.patch(`/api/v1/playlists/${id}`).set(auth(alice.accessToken)).send({ isPublic: true });
  assert.equal(patched.body.isPublic, true);
  assert.equal((await api.get(`/api/v1/playlists/${id}`).set(auth(bob.accessToken))).body.tracks.length, 1);
  assert.equal((await api.patch(`/api/v1/playlists/${id}`).set(auth(bob.accessToken)).send({ name: 'hackeada' })).status, 403);
  assert.equal((await api.delete(`/api/v1/playlists/${id}`).set(auth(bob.accessToken))).status, 403);

  // Un PATCH parcial no altera otros campos
  const renamed = await api.patch(`/api/v1/playlists/${id}`).set(auth(alice.accessToken)).send({ name: 'Renombrada' });
  assert.equal(renamed.body.isPublic, true);
});

test('plan Free limitado a 5 playlists', async () => {
  const mine = (await api.get('/api/v1/playlists/me').set(auth(bob.accessToken))).body.pagination.total;
  for (let i = mine; i < 5; i++) {
    await api.post('/api/v1/playlists').set(auth(bob.accessToken)).send({ name: `Lista ${i}` });
  }
  const res = await api.post('/api/v1/playlists').set(auth(bob.accessToken)).send({ name: 'Sexta' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'PLAN_LIMIT');
});

// ---------- Suscripciones ----------

test('suscripción Premium y cancelación', async () => {
  const bad = await api.post('/api/v1/subscriptions').set(auth(bob.accessToken)).send({ planId: 'premium', paymentToken: '4111111111111111' });
  assert.equal(bad.status, 400, 'no se aceptan números de tarjeta');

  const sub = await api.post('/api/v1/subscriptions').set(auth(bob.accessToken)).send({ planId: 'premium', paymentToken: 'tok_visa' });
  assert.equal(sub.status, 201);
  assert.equal((await api.get('/api/v1/users/me').set(auth(bob.accessToken))).body.plan, 'premium');

  // Ya en premium, puede pasar el límite de playlists
  assert.equal((await api.post('/api/v1/playlists').set(auth(bob.accessToken)).send({ name: 'Sexta' })).status, 201);

  assert.equal((await api.delete('/api/v1/subscriptions/me').set(auth(bob.accessToken))).status, 204);
  assert.equal((await api.get('/api/v1/users/me').set(auth(bob.accessToken))).body.plan, 'free');
});

// ---------- Revocación de sesiones ----------

test('cambio de contraseña invalida los tokens anteriores', async () => {
  const reg = (await api.post('/api/v1/auth/register').send({ email: 'carl@test.com', password: 'Carl#Seguro12', displayName: 'Carl' })).body;
  const res = await api.put('/api/v1/auth/password').set(auth(reg.accessToken))
    .send({ currentPassword: 'Carl#Seguro12', newPassword: 'Carl#Nueva1234' });
  assert.equal(res.status, 204);
  assert.equal((await api.get('/api/v1/users/me').set(auth(reg.accessToken))).body.error.code, 'TOKEN_REVOKED');
  assert.equal((await api.post('/api/v1/auth/login').send({ email: 'carl@test.com', password: 'Carl#Nueva1234' })).status, 200);
});

test('cambiar rol invalida tokens con el rol anterior', async () => {
  const reg = (await api.post('/api/v1/auth/register').send({ email: 'dana@test.com', password: 'Dana#Segura12', displayName: 'Dana' })).body;
  const res = await api.patch(`/api/v1/users/${reg.user.id}/role`).set(auth(admin.accessToken)).send({ role: 'admin' });
  assert.equal(res.body.role, 'admin');
  assert.equal((await api.get('/api/v1/users/me').set(auth(reg.accessToken))).status, 401);
});

// ---------- Robustez ----------

test('JSON malformado → 400 y cabeceras de seguridad presentes', async () => {
  const res = await api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
  assert.equal(res.status, 400);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['x-request-id']);
});

test('cuerpo demasiado grande → 413', async () => {
  const res = await api.post('/api/v1/auth/login').send({ email: 'a@a.com', password: 'x'.repeat(20000) });
  assert.equal(res.status, 413);
});

test('ruta inexistente → 404', async () => {
  assert.equal((await api.get('/api/v1/no-existe')).status, 404);
});
