const { z } = require('zod');

// Política de contraseñas. Máx. 72 caracteres porque bcrypt ignora el resto.
const password = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(72, 'Máximo 72 caracteres')
  .regex(/[a-z]/, 'Debe incluir una minúscula')
  .regex(/[A-Z]/, 'Debe incluir una mayúscula')
  .regex(/[0-9]/, 'Debe incluir un número')
  .regex(/[^A-Za-z0-9]/, 'Debe incluir un símbolo');

// .strict() rechaza campos no esperados: evita "mass assignment"
// (p. ej. que alguien envíe "role": "admin" al registrarse).
const register = z.strictObject({
  email: z.email('Correo inválido').max(254).transform((e) => e.toLowerCase()),
  password,
  displayName: z.string().trim().min(2).max(50),
  country: z.string().length(2, 'Código ISO de 2 letras, ej. GT').toUpperCase().optional(),
  birthDate: z.iso.date('Formato YYYY-MM-DD').optional(),
});

const login = z.strictObject({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(72),
});

const refresh = z.strictObject({
  refreshToken: z.string().min(1),
});

const changePassword = z.strictObject({
  currentPassword: z.string().min(1).max(72),
  newPassword: password,
});

module.exports = { register, login, refresh, changePassword, password };
