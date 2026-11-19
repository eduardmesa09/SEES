import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { apiLocal } from './app/core/api-navegador';
import { API_EN_NAVEGADOR } from './app/core/modo';

// Versión de GitHub Pages: la base de datos del navegador empieza a abrir mientras arranca Angular.
if (API_EN_NAVEGADOR) apiLocal().catch((e) => console.error('[sses] API en el navegador', e));

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
