const config = require('./config');
const seed = require('./db/seed');
const app = require('./app');

if (seed()) console.log('🌱 Base de datos vacía: se cargaron datos de demostración.');

const server = app.listen(config.port, () => {
  console.log(`🎵 SoundWave API escuchando en http://localhost:${config.port}`);
  console.log(`📚 Documentación Swagger: http://localhost:${config.port}/api-docs`);
});

// Cierre ordenado: termina las peticiones en curso antes de salir.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nCerrando servidor...');
    server.close(() => process.exit(0));
  });
}
