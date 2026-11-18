import { Routes } from '@angular/router';
import { conSesion, contrasenaDefinida, paraPerfil } from './core/acceso';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./paginas/login.component').then((m) => m.LoginComponent) },
  {
    path: 'cambiar-contrasena',
    canActivate: [conSesion],
    loadComponent: () => import('./paginas/cambiar-contrasena.component').then((m) => m.CambiarContrasenaComponent),
  },
  {
    path: '',
    canActivate: [conSesion, contrasenaDefinida],
    loadComponent: () => import('./paginas/marco.component').then((m) => m.MarcoComponent),
    children: [
      {
        path: 'estrategias',
        canActivate: [paraPerfil('TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL')],
        loadComponent: () => import('./paginas/estrategias-lista.component').then((m) => m.EstrategiasListaComponent),
      },
      {
        path: 'estrategias/nueva',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/estrategia-form.component').then((m) => m.EstrategiaFormComponent),
      },
      {
        path: 'estrategias/:id',
        canActivate: [paraPerfil('TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL')],
        loadComponent: () => import('./paginas/estrategia-detalle.component').then((m) => m.EstrategiaDetalleComponent),
      },
      {
        path: 'estrategias/:id/editar',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/estrategia-form.component').then((m) => m.EstrategiaFormComponent),
      },
      {
        path: 'estrategias/:id/vincular',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/vincular.component').then((m) => m.VincularComponent),
      },
      {
        path: 'acompanamientos',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/acompanamiento.component').then((m) => m.AcompanamientoComponent),
      },
      {
        path: 'seguimiento',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/seguimiento.component').then((m) => m.SeguimientoComponent),
      },
      {
        path: 'observaciones',
        canActivate: [paraPerfil('TUTOR')],
        loadComponent: () => import('./paginas/observaciones.component').then((m) => m.ObservacionesComponent),
      },
      {
        path: 'tablero',
        canActivate: [paraPerfil('TUTOR_LIDER')],
        loadComponent: () => import('./paginas/tablero.component').then((m) => m.TableroComponent),
      },
      {
        path: 'solicitudes',
        canActivate: [paraPerfil('TUTOR_LIDER')],
        loadComponent: () => import('./paginas/solicitudes.component').then((m) => m.SolicitudesComponent),
      },
      {
        path: 'reportes',
        canActivate: [paraPerfil('TUTOR_LIDER')],
        loadComponent: () => import('./paginas/reportes-ley.component').then((m) => m.ReportesLeyComponent),
      },
      {
        path: 'control',
        canActivate: [paraPerfil('ENTE_CONTROL')],
        loadComponent: () => import('./paginas/control.component').then((m) => m.ControlComponent),
      },
      {
        path: 'auditoria',
        canActivate: [paraPerfil('ADMIN')],
        loadComponent: () => import('./paginas/auditoria.component').then((m) => m.AuditoriaComponent),
      },
      {
        path: 'usuarios',
        canActivate: [paraPerfil('ADMIN')],
        loadComponent: () => import('./paginas/usuarios.component').then((m) => m.UsuariosComponent),
      },
      {
        path: 'cargas',
        canActivate: [paraPerfil('ADMIN')],
        loadComponent: () => import('./paginas/cargas.component').then((m) => m.CargasComponent),
      },
      {
        path: 'monitoreo',
        canActivate: [paraPerfil('SOPORTE')],
        loadComponent: () => import('./paginas/monitoreo.component').then((m) => m.MonitoreoComponent),
      },
      { path: '', pathMatch: 'full', canActivate: [paraPerfil()], children: [] },
    ],
  },
  { path: '**', redirectTo: '' },
];
