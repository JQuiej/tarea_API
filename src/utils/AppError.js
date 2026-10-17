// Error controlado de la aplicación: lleva código HTTP y un código legible
// para que el cliente pueda reaccionar sin depender del texto del mensaje.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Solicitud inválida', details) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'No autenticado') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'No tienes permiso para realizar esta acción') {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Recurso') {
    return new AppError(404, 'NOT_FOUND', `${resource} no encontrado`);
  }

  static conflict(message) {
    return new AppError(409, 'CONFLICT', message);
  }
}

module.exports = AppError;
