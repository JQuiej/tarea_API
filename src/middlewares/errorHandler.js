const AppError = require('../utils/AppError');

function notFound(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `La ruta ${req.method} ${req.path} no existe`));
}

// Manejador central de errores: formato de respuesta uniforme y sin filtrar
// detalles internos (stack traces, SQL) al cliente.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (err.type === 'entity.parse.failed') {
    error = AppError.badRequest('El cuerpo de la petición no es JSON válido');
  } else if (err.type === 'entity.too.large') {
    error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición es demasiado grande');
  } else if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    error = AppError.badRequest('Referencia a un recurso que no existe');
  } else if (!(err instanceof AppError)) {
    console.error(`[${req.id}]`, err);
    error = new AppError(500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }

  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
      requestId: req.id,
    },
  };
  res.status(error.status).json(body);
}

module.exports = { notFound, errorHandler };
