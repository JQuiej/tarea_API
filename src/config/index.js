// Configuración centralizada. Se valida al arrancar: si falta un secreto
// o es débil, la API no inicia (principio "fail fast").
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/soundwave.db'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('soundwave-api'),
  JWT_AUDIENCE: z.string().default('soundwave-clients'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  SEED_ADMIN_EMAIL: z.email().default('admin@soundwave.local'),
  SEED_ADMIN_PASSWORD: z.string().min(10).default('Admin#2026Seguro'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Configuración inválida. Revisa tu archivo .env (puedes copiar .env.example):');
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error('❌ JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos.');
  process.exit(1);
}

module.exports = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  dbPath: env.DB_PATH,
  bcryptRounds: env.BCRYPT_ROUNDS,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  seedAdmin: { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
  },
};
