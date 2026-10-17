const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const { accessSecret, refreshSecret, accessExpiresIn, refreshExpiresIn, issuer, audience, algorithm } = config.jwt;

// Access token: vida corta, viaja en cada petición (Authorization: Bearer).
// Solo lleva lo mínimo necesario; NUNCA datos sensibles (el payload es legible).
function signAccessToken(user) {
  return jwt.sign(
    { role: user.role, plan: user.plan_id, ver: user.token_version, type: 'access' },
    accessSecret,
    { algorithm, expiresIn: accessExpiresIn, issuer, audience, subject: user.id, jwtid: crypto.randomUUID() },
  );
}

// Refresh token: vida larga, solo sirve para obtener nuevos access tokens.
// Se firma con OTRO secreto para que no pueda usarse como access token.
function signRefreshToken(user, { jti, familyId }) {
  return jwt.sign(
    { fam: familyId, type: 'refresh' },
    refreshSecret,
    { algorithm, expiresIn: refreshExpiresIn, issuer, audience, subject: user.id, jwtid: jti },
  );
}

// Se fija explícitamente el algoritmo aceptado para evitar el ataque
// "alg: none" o la confusión de algoritmos.
function verifyAccessToken(token) {
  const payload = jwt.verify(token, accessSecret, { algorithms: [algorithm], issuer, audience });
  if (payload.type !== 'access') throw new jwt.JsonWebTokenError('Tipo de token inválido');
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, refreshSecret, { algorithms: [algorithm], issuer, audience });
  if (payload.type !== 'refresh') throw new jwt.JsonWebTokenError('Tipo de token inválido');
  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken };
