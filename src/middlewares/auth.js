const jwt = require('jsonwebtoken');
const db = require('../db');
const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/jwt');

const findUser = db.prepare('SELECT id, email, display_name, role, plan_id, token_version FROM users WHERE id = ?');

// Verifica el JWT del header Authorization y carga al usuario.
function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Falta el token. Usa el header: Authorization: Bearer <token>'));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError(401, 'TOKEN_EXPIRED', 'El token expiró. Usa /api/v1/auth/refresh para renovarlo'));
    }
    return next(new AppError(401, 'TOKEN_INVALID', 'Token inválido'));
  }

  // Se consulta la BD para que un usuario eliminado, o un token emitido antes de
  // un "cerrar todas las sesiones"/cambio de contraseña, deje de funcionar.
  const user = findUser.get(payload.sub);
  if (!user || user.token_version !== payload.ver) {
    return next(new AppError(401, 'TOKEN_REVOKED', 'La sesión ya no es válida, inicia sesión de nuevo'));
  }

  req.user = { id: user.id, email: user.email, role: user.role, plan: user.plan_id };
  next();
}

// Control de acceso basado en roles (RBAC).
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };
}

module.exports = { authenticate, authorize };
