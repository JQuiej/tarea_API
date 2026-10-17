const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../db');
const config = require('../../config');
const AppError = require('../../utils/AppError');
const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require('../../utils/jwt');
const { toPublicUser } = require('../users/users.mapper');

// Hash ficticio: si el correo no existe igual se ejecuta bcrypt.compare, así el
// tiempo de respuesta no revela qué correos están registrados.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', config.bcryptRounds);

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare(`INSERT INTO users (id, email, password_hash, display_name, country, birth_date)
    VALUES (@id, @email, @password_hash, @display_name, @country, @birth_date)`),
  insertRefresh: db.prepare(`INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)`),
  refreshById: db.prepare('SELECT * FROM refresh_tokens WHERE id = ?'),
  revokeRefresh: db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now'), replaced_by = ? WHERE id = ?`),
  revokeFamily: db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE family_id = ? AND revoked_at IS NULL`),
  revokeAllForUser: db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`),
  bumpTokenVersion: db.prepare(`UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`),
  updatePassword: db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`),
};

function issueTokens(user, familyId = crypto.randomUUID()) {
  const jti = crypto.randomUUID();
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, { jti, familyId });
  const { exp } = jwt.decode(refreshToken);
  q.insertRefresh.run(jti, user.id, familyId, hashToken(refreshToken), new Date(exp * 1000).toISOString());
  return {
    jti,
    tokens: {
      tokenType: 'Bearer',
      accessToken,
      accessTokenExpiresIn: config.jwt.accessExpiresIn,
      refreshToken,
      refreshTokenExpiresIn: config.jwt.refreshExpiresIn,
    },
  };
}

async function register(data) {
  if (q.userByEmail.get(data.email)) {
    throw AppError.conflict('Ya existe una cuenta con ese correo');
  }
  const id = crypto.randomUUID();
  q.insertUser.run({
    id,
    email: data.email,
    password_hash: await bcrypt.hash(data.password, config.bcryptRounds),
    display_name: data.displayName,
    country: data.country ?? 'GT',
    birth_date: data.birthDate ?? null,
  });
  const user = q.userById.get(id);
  return { user: toPublicUser(user), ...issueTokens(user) };
}

async function login({ email, password }) {
  const user = q.userByEmail.get(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    // Mensaje genérico: no se indica si falló el correo o la contraseña.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');
  }
  return { user: toPublicUser(user), ...issueTokens(user) };
}

// Rotación de refresh tokens con detección de reutilización:
// cada refresh token sirve UNA sola vez. Si alguien presenta uno ya usado,
// se asume robo y se revoca toda la familia (cadena) de tokens.
function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'REFRESH_INVALID', 'Refresh token inválido o expirado');
  }

  const stored = q.refreshById.get(payload.jti);
  if (!stored || stored.token_hash !== hashToken(refreshToken)) {
    throw new AppError(401, 'REFRESH_INVALID', 'Refresh token inválido o expirado');
  }
  if (stored.revoked_at) {
    q.revokeFamily.run(stored.family_id);
    throw new AppError(401, 'REFRESH_REUSED', 'Se detectó reutilización del refresh token; la sesión fue cerrada por seguridad');
  }

  const user = q.userById.get(payload.sub);
  if (!user) throw new AppError(401, 'REFRESH_INVALID', 'Refresh token inválido o expirado');

  return db.transaction(() => {
    const issued = issueTokens(user, stored.family_id);
    q.revokeRefresh.run(issued.jti, stored.id);
    return issued;
  })();
}

function logout(refreshToken) {
  try {
    const payload = verifyRefreshToken(refreshToken);
    const stored = q.refreshById.get(payload.jti);
    if (stored && stored.user_id === payload.sub) q.revokeFamily.run(stored.family_id);
  } catch {
    // Logout es idempotente: un token inválido simplemente no hace nada.
  }
}

// Invalida TODOS los access y refresh tokens del usuario.
function logoutAll(userId) {
  db.transaction(() => {
    q.bumpTokenVersion.run(userId);
    q.revokeAllForUser.run(userId);
  })();
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = q.userById.get(userId);
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'La contraseña actual es incorrecta');
  }
  const hash = await bcrypt.hash(newPassword, config.bcryptRounds);
  db.transaction(() => {
    q.updatePassword.run(hash, userId);
    q.bumpTokenVersion.run(userId);
    q.revokeAllForUser.run(userId);
  })();
}

module.exports = { register, login, refresh, logout, logoutAll, changePassword };
