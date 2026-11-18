import express from 'express';
import { AppError, manejadorDeErrores } from './errores';
import { medir } from './modules/monitoreo/metricas';
import { rutas } from './rutas';

export function crearApp() {
  const app = express();
  app.set('trust proxy', true); // la dirección de origen llega por el proxy (nginx)
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Cada petición deja su duración y su resultado para la consola de monitoreo (CU-15).
  app.use('/api', medir, rutas);

  app.use((req, _res, next) => {
    next(new AppError(404, 'RUTA_NO_ENCONTRADA', `No existe la operación ${req.method} ${req.originalUrl}.`));
  });
  app.use(manejadorDeErrores);
  return app;
}
