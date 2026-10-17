// Especificación OpenAPI 3 (contrato de la API). Se sirve en /api-docs con Swagger UI.
const uuid = { type: 'string', format: 'uuid' };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ content: { 'application/json': { schema } } });
const body = (schema, example) => ({ required: true, content: { 'application/json': { schema, ...(example && { example }) } } });
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: uuid });
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
];
const searchParam = { name: 'search', in: 'query', schema: { type: 'string' } };
const paged = (item) => json({
  type: 'object',
  properties: { data: { type: 'array', items: ref(item) }, pagination: ref('Pagination') },
});

const err = (description) => ({ description, ...json(ref('Error')) });
const E = {
  400: err('Datos inválidos'),
  401: err('No autenticado / token inválido o expirado'),
  403: err('Sin permisos'),
  404: err('No encontrado'),
  409: err('Conflicto'),
  429: err('Demasiadas peticiones'),
};
const noContent = { 204: { description: 'Sin contenido' } };
const adminOnly = ' **(solo admin)**';

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SoundWave API',
    version: '1.0.0',
    description: [
      'API REST análoga a Spotify: clientes (usuarios), catálogo musical, playlists y suscripciones.',
      '',
      '**Cómo autenticarse:**',
      '1. `POST /auth/login` (o `/auth/register`) → copia el `accessToken`.',
      '2. Presiona el botón **Authorize** 🔒 y pega el token.',
      '3. El access token dura 15 min; renuévalo con `POST /auth/refresh` usando el `refreshToken`.',
      '',
      'Usuarios de prueba: `admin@soundwave.local` / `Admin#2026Seguro` (admin) y `demo@soundwave.local` / `Demo#2026Seguro` (free).',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1', description: 'Versión 1' }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Registro, login y manejo de tokens JWT' },
    { name: 'Usuarios', description: 'Perfil del cliente, favoritos, historial y administración' },
    { name: 'Artistas' }, { name: 'Álbumes' }, { name: 'Canciones' },
    { name: 'Playlists' }, { name: 'Suscripciones' }, { name: 'Búsqueda' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'BAD_REQUEST' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
              requestId: uuid,
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } },
      },
      Tokens: {
        type: 'object',
        properties: {
          tokenType: { type: 'string', example: 'Bearer' },
          accessToken: { type: 'string' },
          accessTokenExpiresIn: { type: 'string', example: '15m' },
          refreshToken: { type: 'string' },
          refreshTokenExpiresIn: { type: 'string', example: '7d' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: uuid, email: { type: 'string' }, displayName: { type: 'string' }, country: { type: 'string' },
          birthDate: { type: 'string', format: 'date', nullable: true },
          role: { type: 'string', enum: ['user', 'admin'] },
          plan: { type: 'string', enum: ['free', 'student', 'premium', 'family'] },
          createdAt: { type: 'string' },
        },
      },
      AuthResponse: { allOf: [{ type: 'object', properties: { user: ref('User') } }, ref('Tokens')] },
      Artist: {
        type: 'object',
        properties: { id: uuid, name: { type: 'string' }, genre: { type: 'string' }, country: { type: 'string' }, bio: { type: 'string' }, monthlyListeners: { type: 'integer' } },
      },
      Album: {
        type: 'object',
        properties: {
          id: uuid, title: { type: 'string' }, releaseDate: { type: 'string', format: 'date' },
          type: { type: 'string', enum: ['album', 'single', 'ep'] }, coverUrl: { type: 'string', nullable: true },
          artist: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
        },
      },
      Track: {
        type: 'object',
        properties: {
          id: uuid, title: { type: 'string' }, durationMs: { type: 'integer' }, trackNumber: { type: 'integer' },
          explicit: { type: 'boolean' }, playCount: { type: 'integer' },
          album: { type: 'object', properties: { id: uuid, title: { type: 'string' }, releaseDate: { type: 'string' } } },
          artist: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
        },
      },
      Playlist: {
        type: 'object',
        properties: {
          id: uuid, name: { type: 'string' }, description: { type: 'string', nullable: true }, isPublic: { type: 'boolean' },
          owner: { type: 'object', properties: { id: uuid, displayName: { type: 'string' } } },
          totalTracks: { type: 'integer' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' },
        },
      },
      Plan: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' }, priceUsd: { type: 'number' }, maxMembers: { type: 'integer' }, features: { type: 'string' } },
      },
    },
  },
  paths: {
    // ---------------- Auth ----------------
    '/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Registrar un cliente nuevo', security: [],
        requestBody: body({
          type: 'object', required: ['email', 'password', 'displayName'],
          properties: { email: { type: 'string' }, password: { type: 'string', description: '10-72 caracteres, mayúscula, minúscula, número y símbolo' }, displayName: { type: 'string' }, country: { type: 'string', example: 'GT' }, birthDate: { type: 'string', format: 'date' } },
        }, { email: 'ana@correo.com', password: 'MiClave#2026', displayName: 'Ana López', country: 'GT' }),
        responses: { 201: { description: 'Cuenta creada', ...json(ref('AuthResponse')) }, 400: E[400], 409: E[409], 429: E[429] },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Iniciar sesión y obtener tokens JWT', security: [],
        requestBody: body({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
          { email: 'demo@soundwave.local', password: 'Demo#2026Seguro' }),
        responses: { 200: { description: 'OK', ...json(ref('AuthResponse')) }, 401: E[401], 429: E[429] },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'], summary: 'Renovar el access token (rota el refresh token)', security: [],
        description: 'Cada refresh token se puede usar UNA vez. Si se reutiliza uno viejo, se cierra toda la sesión (detección de robo).',
        requestBody: body({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }),
        responses: { 200: { description: 'Nuevos tokens', ...json(ref('Tokens')) }, 401: E[401] },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'], summary: 'Cerrar sesión (revoca el refresh token)', security: [],
        requestBody: body({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }),
        responses: noContent,
      },
    },
    '/auth/logout-all': {
      post: { tags: ['Auth'], summary: 'Cerrar sesión en todos los dispositivos', responses: { ...noContent, 401: E[401] } },
    },
    '/auth/password': {
      put: {
        tags: ['Auth'], summary: 'Cambiar contraseña (invalida todas las sesiones)',
        requestBody: body({ type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } } }),
        responses: { ...noContent, 400: E[400], 401: E[401] },
      },
    },

    // ---------------- Usuarios ----------------
    '/users/me': {
      get: { tags: ['Usuarios'], summary: 'Ver mi perfil', responses: { 200: { description: 'OK', ...json(ref('User')) }, 401: E[401] } },
      patch: {
        tags: ['Usuarios'], summary: 'Actualizar mi perfil',
        requestBody: body({ type: 'object', properties: { displayName: { type: 'string' }, country: { type: 'string' }, birthDate: { type: 'string', format: 'date' } } }),
        responses: { 200: { description: 'OK', ...json(ref('User')) }, 400: E[400] },
      },
      delete: {
        tags: ['Usuarios'], summary: 'Eliminar mi cuenta (requiere contraseña)',
        requestBody: body({ type: 'object', required: ['password'], properties: { password: { type: 'string' } } }),
        responses: { ...noContent, 401: E[401] },
      },
    },
    '/users/me/liked-tracks': {
      get: { tags: ['Usuarios'], summary: 'Canciones que me gustan', parameters: pageParams, responses: { 200: { description: 'OK', ...paged('Track') } } },
    },
    '/users/me/liked-tracks/{trackId}': {
      put: { tags: ['Usuarios'], summary: 'Dar "me gusta" a una canción', parameters: [idParam('trackId')], responses: { ...noContent, 404: E[404] } },
      delete: { tags: ['Usuarios'], summary: 'Quitar "me gusta"', parameters: [idParam('trackId')], responses: noContent },
    },
    '/users/me/history': {
      get: { tags: ['Usuarios'], summary: 'Historial de reproducción', parameters: pageParams, responses: { 200: { description: 'OK' } } },
    },
    '/users': {
      get: { tags: ['Usuarios'], summary: `Listar usuarios${adminOnly}`, parameters: [...pageParams, searchParam], responses: { 200: { description: 'OK', ...paged('User') }, 403: E[403] } },
    },
    '/users/{id}': {
      get: { tags: ['Usuarios'], summary: `Ver usuario${adminOnly}`, parameters: [idParam()], responses: { 200: { description: 'OK', ...json(ref('User')) }, 403: E[403], 404: E[404] } },
      delete: { tags: ['Usuarios'], summary: `Eliminar usuario${adminOnly}`, parameters: [idParam()], responses: { ...noContent, 403: E[403], 404: E[404] } },
    },
    '/users/{id}/role': {
      patch: {
        tags: ['Usuarios'], summary: `Cambiar rol${adminOnly}`, parameters: [idParam()],
        requestBody: body({ type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['user', 'admin'] } } }),
        responses: { 200: { description: 'OK', ...json(ref('User')) }, 403: E[403], 404: E[404] },
      },
    },

    // ---------------- Artistas ----------------
    '/artists': {
      get: { tags: ['Artistas'], summary: 'Listar artistas', parameters: [...pageParams, searchParam, { name: 'genre', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'OK', ...paged('Artist') } } },
      post: {
        tags: ['Artistas'], summary: `Crear artista${adminOnly}`,
        requestBody: body({ type: 'object', required: ['name', 'genre'], properties: { name: { type: 'string' }, genre: { type: 'string' }, country: { type: 'string' }, bio: { type: 'string' } } }, { name: 'Nuevo Artista', genre: 'Indie', country: 'GT' }),
        responses: { 201: { description: 'Creado', ...json(ref('Artist')) }, 400: E[400], 403: E[403] },
      },
    },
    '/artists/{id}': {
      get: { tags: ['Artistas'], summary: 'Ver artista con sus álbumes', parameters: [idParam()], responses: { 200: { description: 'OK' }, 404: E[404] } },
      patch: { tags: ['Artistas'], summary: `Editar artista${adminOnly}`, parameters: [idParam()], requestBody: body({ type: 'object', properties: { name: { type: 'string' }, genre: { type: 'string' }, country: { type: 'string' }, bio: { type: 'string' } } }), responses: { 200: { description: 'OK', ...json(ref('Artist')) }, 403: E[403], 404: E[404] } },
      delete: { tags: ['Artistas'], summary: `Eliminar artista${adminOnly}`, parameters: [idParam()], responses: { ...noContent, 403: E[403], 404: E[404] } },
    },
    '/artists/{id}/top-tracks': {
      get: { tags: ['Artistas'], summary: 'Top 10 canciones del artista', parameters: [idParam()], responses: { 200: { description: 'OK' }, 404: E[404] } },
    },

    // ---------------- Álbumes ----------------
    '/albums': {
      get: { tags: ['Álbumes'], summary: 'Listar álbumes', parameters: [...pageParams, searchParam, { name: 'artistId', in: 'query', schema: uuid }], responses: { 200: { description: 'OK', ...paged('Album') } } },
      post: {
        tags: ['Álbumes'], summary: `Crear álbum${adminOnly}`,
        requestBody: body({ type: 'object', required: ['artistId', 'title', 'releaseDate'], properties: { artistId: uuid, title: { type: 'string' }, releaseDate: { type: 'string', format: 'date' }, type: { type: 'string', enum: ['album', 'single', 'ep'] }, coverUrl: { type: 'string', description: 'Solo https' } } }),
        responses: { 201: { description: 'Creado', ...json(ref('Album')) }, 400: E[400], 403: E[403] },
      },
    },
    '/albums/{id}': {
      get: { tags: ['Álbumes'], summary: 'Ver álbum con canciones', parameters: [idParam()], responses: { 200: { description: 'OK' }, 404: E[404] } },
      patch: { tags: ['Álbumes'], summary: `Editar álbum${adminOnly}`, parameters: [idParam()], requestBody: body({ type: 'object', properties: { title: { type: 'string' }, releaseDate: { type: 'string', format: 'date' }, type: { type: 'string' }, coverUrl: { type: 'string' } } }), responses: { 200: { description: 'OK', ...json(ref('Album')) }, 404: E[404] } },
      delete: { tags: ['Álbumes'], summary: `Eliminar álbum${adminOnly}`, parameters: [idParam()], responses: { ...noContent, 404: E[404] } },
    },

    // ---------------- Canciones ----------------
    '/tracks': {
      get: {
        tags: ['Canciones'], summary: 'Listar / buscar canciones',
        parameters: [...pageParams, searchParam, { name: 'artistId', in: 'query', schema: uuid }, { name: 'albumId', in: 'query', schema: uuid }, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['popular', 'recent', 'title'] } }],
        responses: { 200: { description: 'OK', ...paged('Track') } },
      },
      post: {
        tags: ['Canciones'], summary: `Crear canción${adminOnly}`,
        requestBody: body({ type: 'object', required: ['albumId', 'title', 'durationMs'], properties: { albumId: uuid, title: { type: 'string' }, durationMs: { type: 'integer' }, trackNumber: { type: 'integer' }, explicit: { type: 'boolean' } } }),
        responses: { 201: { description: 'Creado', ...json(ref('Track')) }, 400: E[400], 403: E[403] },
      },
    },
    '/tracks/{id}': {
      get: { tags: ['Canciones'], summary: 'Ver canción', parameters: [idParam()], responses: { 200: { description: 'OK', ...json(ref('Track')) }, 404: E[404] } },
      patch: { tags: ['Canciones'], summary: `Editar canción${adminOnly}`, parameters: [idParam()], requestBody: body({ type: 'object', properties: { title: { type: 'string' }, durationMs: { type: 'integer' }, trackNumber: { type: 'integer' }, explicit: { type: 'boolean' } } }), responses: { 200: { description: 'OK' }, 404: E[404] } },
      delete: { tags: ['Canciones'], summary: `Eliminar canción${adminOnly}`, parameters: [idParam()], responses: { ...noContent, 404: E[404] } },
    },
    '/tracks/{id}/play': {
      post: {
        tags: ['Canciones'], summary: 'Reproducir canción',
        description: 'Registra la reproducción en el historial. Plan Free: vista previa de 30 s con anuncios. Premium: completa a 320 kbps.',
        parameters: [idParam()], responses: { 200: { description: 'Información de reproducción' }, 404: E[404] },
      },
    },

    // ---------------- Playlists ----------------
    '/playlists': {
      get: { tags: ['Playlists'], summary: 'Playlists públicas de la comunidad', parameters: [...pageParams, searchParam], responses: { 200: { description: 'OK', ...paged('Playlist') } } },
      post: {
        tags: ['Playlists'], summary: 'Crear playlist (Free: máximo 5)',
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, isPublic: { type: 'boolean', default: true } } }, { name: 'Para programar', description: 'Música para concentrarse', isPublic: true }),
        responses: { 201: { description: 'Creada', ...json(ref('Playlist')) }, 400: E[400], 403: E[403] },
      },
    },
    '/playlists/me': {
      get: { tags: ['Playlists'], summary: 'Mis playlists', parameters: pageParams, responses: { 200: { description: 'OK', ...paged('Playlist') } } },
    },
    '/playlists/{id}': {
      get: { tags: ['Playlists'], summary: 'Ver playlist con canciones', parameters: [idParam()], responses: { 200: { description: 'OK' }, 404: E[404] } },
      patch: { tags: ['Playlists'], summary: 'Editar playlist (solo dueño)', parameters: [idParam()], requestBody: body({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, isPublic: { type: 'boolean' } } }), responses: { 200: { description: 'OK', ...json(ref('Playlist')) }, 403: E[403], 404: E[404] } },
      delete: { tags: ['Playlists'], summary: 'Eliminar playlist (dueño o admin)', parameters: [idParam()], responses: { ...noContent, 403: E[403], 404: E[404] } },
    },
    '/playlists/{id}/tracks': {
      post: {
        tags: ['Playlists'], summary: 'Agregar canción a la playlist (solo dueño)', parameters: [idParam()],
        requestBody: body({ type: 'object', required: ['trackId'], properties: { trackId: uuid } }),
        responses: { 201: { description: 'Agregada', ...json(ref('Playlist')) }, 403: E[403], 404: E[404], 409: E[409] },
      },
    },
    '/playlists/{id}/tracks/{trackId}': {
      delete: { tags: ['Playlists'], summary: 'Quitar canción de la playlist (solo dueño)', parameters: [idParam(), idParam('trackId')], responses: { ...noContent, 403: E[403], 404: E[404] } },
    },

    // ---------------- Suscripciones ----------------
    '/subscriptions/plans': {
      get: { tags: ['Suscripciones'], summary: 'Planes disponibles (público)', security: [], responses: { 200: { description: 'OK', ...json({ type: 'object', properties: { data: { type: 'array', items: ref('Plan') } } }) } } },
    },
    '/subscriptions': {
      post: {
        tags: ['Suscripciones'], summary: 'Suscribirse a un plan Premium (pago simulado)',
        description: 'La API nunca recibe datos de tarjeta: solo un token de la pasarela de pago (ej. `tok_visa`).',
        requestBody: body({ type: 'object', required: ['planId', 'paymentToken'], properties: { planId: { type: 'string', enum: ['student', 'premium', 'family'] }, paymentToken: { type: 'string' } } }, { planId: 'premium', paymentToken: 'tok_visa' }),
        responses: { 201: { description: 'Suscrito' }, 400: E[400], 409: E[409] },
      },
    },
    '/subscriptions/me': {
      get: { tags: ['Suscripciones'], summary: 'Mi suscripción actual', responses: { 200: { description: 'OK' } } },
      delete: { tags: ['Suscripciones'], summary: 'Cancelar suscripción (vuelve a Free)', responses: { ...noContent, 404: E[404] } },
    },

    // ---------------- Búsqueda ----------------
    '/search': {
      get: {
        tags: ['Búsqueda'], summary: 'Búsqueda global',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, example: 'luna' },
          { name: 'type', in: 'query', schema: { type: 'string', default: 'track,artist,album,playlist' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 20, default: 5 } },
        ],
        responses: { 200: { description: 'Resultados agrupados por tipo' }, 400: E[400] },
      },
    },
  },
};
