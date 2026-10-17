const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const openapi = require('./docs/openapi');
const AppError = require('./utils/AppError');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// ---------- Seguridad de transporte y cabeceras ----------
app.use(helmet()); // CSP, X-Content-Type-Options, HSTS, quita X-Powered-By, etc.
app.use(cors({
  origin(origin, cb) {
    // Peticiones sin Origin (Postman, curl, apps móviles) se permiten;
    // desde navegadores solo los orígenes de la lista blanca.
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new AppError(403, 'CORS_BLOCKED', 'Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
}));

// ---------- Trazabilidad ----------
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});
if (config.env !== 'test') {
  // No se registra el header Authorization: los tokens no deben quedar en logs.
  morgan.token('id', (req) => req.id);
  app.use(morgan(':id :method :url :status :response-time ms'));
}

// ---------- Límites ----------
app.use(express.json({ limit: '10kb' })); // evita cuerpos gigantes (DoS)
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: config.env === 'test' ? 10000 : 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones, intenta en un minuto' } },
}));

// ---------- Rutas ----------
app.get('/', (req, res) => res.redirect('/api-docs'));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/api-docs.json', (req, res) => res.json(openapi));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, {
  customSiteTitle: 'SoundWave API - Documentación',
  swaggerOptions: { persistAuthorization: true },
}));

const v1 = express.Router();
v1.use('/auth', require('./modules/auth/auth.routes'));
v1.use('/users', require('./modules/users/users.routes'));
v1.use('/artists', require('./modules/artists/artists.routes'));
v1.use('/albums', require('./modules/albums/albums.routes'));
v1.use('/tracks', require('./modules/tracks/tracks.routes'));
v1.use('/playlists', require('./modules/playlists/playlists.routes'));
v1.use('/subscriptions', require('./modules/subscriptions/subscriptions.routes'));
v1.use('/search', require('./modules/search/search.routes'));
app.use('/api/v1', v1); // versionado en la URL: /api/v2 podrá convivir sin romper clientes

app.use(notFound);
app.use(errorHandler);

module.exports = app;
