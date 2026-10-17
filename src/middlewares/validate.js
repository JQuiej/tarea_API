const AppError = require('../utils/AppError');

// Valida body, params y query contra esquemas Zod. Los datos ya limpios quedan
// en req.valid; los controladores nunca leen req.body "crudo".
function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};
    for (const source of ['params', 'query', 'body']) {
      if (!schemas[source]) continue;
      const result = schemas[source].safeParse(req[source] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({
          field: [source, ...i.path].join('.'),
          message: i.message,
        }));
        return next(AppError.badRequest('Datos de entrada inválidos', details));
      }
      req.valid[source] = result.data;
    }
    next();
  };
}

module.exports = validate;
