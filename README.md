# Piloto SSES — MVP

Producto Mínimo Viable del **Sistema de Seguimiento de Actividades Extracurriculares (SSES)**. Parte del numeral 3.8 de la propuesta de NovaTech Asociados para el Ministerio de Educación Nacional y cubre los cinco actores del numeral 2.2.

El núcleo del numeral 3.8 es el ciclo completo de una estrategia estudiantil, de extremo a extremo:

1. Crear la estrategia asociada a una entidad precargada.
2. Vincular estudiantes precargados.
3. **Bloqueo automático de la edición** al vincular el primer estudiante.
4. Registrar el acompañamiento pedagógico mensual a los docentes.
5. Registrar el seguimiento semanal del mes.
6. **Tablero** con la cobertura del periodo y el cumplimiento del tutor, que distingue el registro sostenido del concentrado al cierre.

Además incluye las funciones que completan el Piloto:

- Desvinculación de estudiantes.
- Acompañamiento grupal.
- Cierre y reapertura del periodo mensual.
- Reportes de ley certificados.
- Consulta del ente de control.
- Administración de usuarios y cargas masivas.
- Monitoreo de las sesiones del pilotaje.

Todos los datos son sintéticos (RQ_021): no hay información real de estudiantes ni de docentes.

> **Actores.** El acompañamiento pedagógico lo realiza y lo registra el **tutor**, sobre los **docentes** de la institución, que no son usuarios del sistema. El **tutor líder** supervisa y evalúa a los tutores.

## Contenido del repositorio

| Ruta | Qué es |
|---|---|
| `api/` | API REST (Node + TypeScript) y sus pruebas |
| `api/navegador/` | Adaptación del API para que corra dentro del navegador (versión en línea) |
| `web/` | Interfaz (Angular) |
| `docker-compose.yml` | Base de datos, API e interfaz en contenedores |
| `iniciar-demo.cmd`, `reiniciar-datos.cmd` | Atajos de Windows para levantar la demo y reiniciar los datos |
| `.github/workflows/pages.yml` | Publicación automática de la versión en línea en GitHub Pages |

## Usarlo en línea, sin instalar nada

**https://eduardmesa09.github.io/SEES/**

Basta con abrir el enlace en un navegador actualizado (Chrome, Edge, Firefox o Safari). No hay que instalar Docker ni Node.

**Cómo funciona.** GitHub Pages solo sirve archivos estáticos. Por eso, en esta versión el API y la base de datos corren **dentro del navegador**:
- La base de datos es PostgreSQL compilado a WebAssembly ([PGlite](https://pglite.dev)), con el mismo esquema, los mismos triggers y los mismos datos sintéticos.
- El API es el mismo código de `api/src`. Solo cambian cuatro piezas de Node por equivalentes para el navegador (ver `api/navegador/shims/`).
- Las 83 pruebas del API también se corren sobre PGlite antes de cada publicación.

**Qué hay que saber:**
- **La primera visita** descarga unos 15 MB y crea la base con los datos sintéticos. Tarda unos segundos. Las siguientes visitas abren la base guardaada en alrededor de un segundo.
- **Los datos viven en ese navegador.** Todas las pestañas del mismo navegador ven los mismos datos, así que se puede tener un perfil por pestaña, igual que con Docker. Otro navegador u otro equipo empieza con sus propios datos.
- **Reiniciar los datos:** en la pantalla de ingreso, *Reiniciar datos de la demostración*. Hace lo mismo que `reiniciar-datos.cmd`.
- Los datos sintéticos se generan relativos a la fecha de la primera visita. Si se vuelve a usar otro mes, conviene reiniciarlos para que el guion funcione tal como está escrito.
- En una ventana privada o de incógnito los datos se borran al cerrarla.

**Publicarla.** El workflow `.github/workflows/pages.yml` publica el sitio en cada push a `main`. Solo hay que activarlo una vez: en el repositorio, *Settings* → *Pages* → *Build and deployment* → *Source*: **GitHub Actions**. El avance se ve en la pestaña *Actions*.

## Cómo levantarlo con Docker

**Requisitos.**
- Git.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y **abierto**.
- Los puertos **8080**, **3000** y **5433** libres.

Node solo hace falta para correr las pruebas o desarrollar sin contenedores.

```
git clone https://github.com/eduardmesa09/SEES.git
cd SEES
```

Para levantarlo, en Windows basta con doble clic en `iniciar-demo.cmd`. En cualquier sistema:

```
docker compose up -d
```

Queda en **http://localhost:8080**. El API responde en http://localhost:3000/api/salud.

**La primera vez:**
- Tarda varios minutos y necesita internet, porque descarga las imágenes base y construye las del Piloto.
- Al arrancar, el API crea la base de datos y carga los datos sintéticos.

**Las siguientes veces:** arranca en segundos y sin internet, con las imágenes ya construidas.

**Después de un `git pull` que cambie el código:** hay que reconstruir con `docker compose up -d --build`, que también necesita internet.

| Para | Windows | Cualquier sistema |
|---|---|---|
| Dejar los datos como recién instalados | `reiniciar-datos.cmd` | `docker compose exec api node dist/reiniciar.js` |
| Apagar | | `docker compose down` |
| Apagar y borrar la base de datos | | `docker compose down -v` |
| Ver los registros del API | | `docker compose logs -f api` |

Los datos sintéticos se generan **relativos a la fecha del día en que se cargan**: el mes anterior queda con historia completa y el mes en curso con historia parcial.

**Si la demo es otro día:** reinicie los datos poco antes de la sustentación para que el guion funcione tal como está escrito. Reiniciar también borra lo que se haya registrado en los ensayos.

**Si cambia el esquema de la base de datos:** el API solo crea el esquema cuando la base está vacía. Si un `git pull` trae cambios en `api/sql/001_schema.sql`, después de reconstruir hay que reiniciar los datos o correr `docker compose down -v`.

## Usuarios de demostración

La pantalla de ingreso tiene un botón por usuario. Contraseña de todos: `Sses2026*`

| Usuario | Perfil | Qué hace |
|---|---|---|
| `tutor1@sses.test` — Camila Torres | Tutor | Crea estrategias, vincula estudiantes, acompaña a los docentes, reporta y cierra el periodo |
| `tutor2@sses.test` — Andrés Mejía | Tutor | Robótica (sostenido) y Huerta (irregular, con sesión grupal), ambas cerradas (región Andina) |
| `tutor3@sses.test` — Luisa Castro | Tutor | Lectura Crítica, concentrada al cierre y **aún sin cerrar** (región Caribe) |
| `lider@sses.test` — Marta Gómez | Tutor líder | Tablero, observaciones, solicitudes y reportes de ley (Andina y Caribe) |
| `control@sses.test` — Patricia Rojas | Ente de control | Reportes de control de todo el país, solo consulta |
| `admin@sses.test` — Ricardo Salazar | Administrador | Usuarios, cargas masivas y auditoría; no ve el registro misional |
| `soporte@sses.test` — Diego Ruiz | Ingeniero de soporte | Consola de monitoreo de las sesiones del pilotaje |

La sesión vive en cada pestaña: puede tener varios perfiles abiertos a la vez, uno por pestaña.

## Guion de la demostración

### Núcleo del MVP (unos 10 minutos)

**1. Tutor — crear la estrategia** · `tutor1`
- *Nueva estrategia*. La entidad se elige de la lista precargada; no se escribe.
- Elegir una entidad, nombre, objetivo, cupo **10**, fecha de inicio **el primer día del mes pasado** y fin dos o tres meses después.
- *Revisar resumen* → *Confirmar y guardar*. Queda **Editable**, con su código `EST-…`.
- Opcional:
  - Crear otra con el mismo nombre en la misma entidad → advertencia de duplicidad.
  - Poner una fecha final anterior a la inicial → el servidor la rechaza.

**2. Tutor — vincular y ver el bloqueo**
- *Vincular estudiantes*, filtrar por grado y marcar el curso completo (21) → *Vincular* → **rechazo por cupo**, sin vincular a nadie.
- Quitar la selección, marcar 6 y vincular → el diálogo muestra **Editable → Bloqueada**.
- En el detalle aparece el aviso de bloqueo y los campos con candado.
- *Probar edición directa al servidor* → **HTTP 403**: el bloqueo lo hace cumplir el servidor, no la pantalla.
- *Solicitar modificación* → queda radicada ante el tutor líder y la estrategia no cambia.

**3. Tutor — acompañamiento a los docentes**
- *Acompañamientos*, mes anterior: solo aparecen los docentes de la estrategia.
- Registrar uno. Un segundo al mismo docente en el mes genera advertencia.
- *Registrar sesión grupal*: se marcan los asistentes y se genera un acompañamiento por cada uno.

**4. Tutor — seguimiento semanal**
- *Seguimiento y cierre*, mes en curso: hay semanas que **aún no ocurren** y no pueden reportarse.
- Cambiar al mes anterior y reportar sus semanas, una de ellas como *No hubo actividad* con su causa. La cobertura sube con cada registro.
- Cada semana queda marcada como registrada **N días después**: el sistema sabe que se diligenció tarde.

**5. Tutor líder — tablero** · `lider`
- *Tablero*, mes anterior. Comparar:
  - *Semillero de Robótica*: marcas repartidas en el mes → **Sostenido**.
  - *Club de Lectura Crítica*: 100 % de cobertura, pero todo apilado el último día → **Concentrado al cierre**.
  - La estrategia recién creada: registrada semanas después → **Concentrado al cierre**.
- Clic en una fila para descender al registro individual, con autor, fecha y hora.

### Funciones que completan el Piloto (unos 10 minutos más)

**6. Tutor — cierre del periodo** · `tutor3`
- *Seguimiento y cierre*, mes anterior: el resumen muestra un docente sin acompañamiento.
- *Cerrar periodo* exige **justificación**. Si ya pasó el plazo (cinco días después de terminar el mes), queda **extemporáneo**.
- Después del cierre no se puede registrar ni editar. *Solicitar reapertura* va al tutor líder.
- En el detalle de una estrategia con estudiantes, *Desvincular* pide motivo y fecha. Si no queda ningún estudiante activo, la estrategia vuelve a ser editable.

**7. Tutor líder — decisiones y reportes de ley** · `lider`
- *Tablero*: cada estrategia muestra si su periodo está cerrado, a tiempo o fuera de plazo. Mientras quede alguno abierto, las cifras se marcan como preliminares. El ícono junto a cada tutor envía una **observación**, que le llega en *Observaciones*.
- *Solicitudes*: aprobar o rechazar reaperturas y modificaciones. Una modificación aprobada habilita **una sola** edición de la estrategia bloqueada.
- *Reportes de ley*, mes anterior:
  - Con *Todo mi territorio*, la estrategia creada en el paso 1 tiene su periodo abierto: no deja certificar y dice qué tutor lo tiene pendiente. Se puede excluir con motivo.
  - Con el alcance *Caribe* (solo Lectura Crítica, ya cerrada en el paso 6), *Certificar* congela el reporte con su **código de verificación**.
  - Certificar otra vez exige justificar el ajuste y crea la **versión 2** sin borrar la 1.

**8. Ente de control — consulta** · `control`
- El sistema avisa desde el inicio que el perfil es **de consulta**.
- *Reportes de control*:
  - El territorio Caribe aparece **certificado**, con su versión y la anterior consultable.
  - El territorio Andina aparece **preliminar**, con su cobertura de información.
- Clic en una estrategia para ver la trazabilidad. *Descargar reporte* entrega un CSV con la marca de certificación o la leyenda de preliminar.
- Cada consulta y cada descarga queda en la auditoría. Cualquier escritura, aun directa al API, responde 403.

**9. Administrador — usuarios y cargas** · `admin`
- *Nuevo usuario*: perfil, ámbito por entidades o territorio, y **credenciales de activación**. En su primer ingreso, la persona debe definir su propia contraseña.
- *Revocar acceso* a un tutor con estrategias exige **reasignarlas**, y cierra sus sesiones de inmediato.
- *Cargas masivas*: *Descargar plantilla*, diligenciarla y cargarla.
  - Si el archivo no corresponde a la plantilla, se rechaza completo.
  - Si hay documentos repetidos, se pueden consolidar.
  - El informe muestra cada fila rechazada con su motivo.
- *Auditoría*: cada operación de la demostración, incluidos los intentos rechazados.

**10. Ingeniero de soporte — sesión del pilotaje** · `soporte`
- La consola muestra los servicios, los usuarios conectados por región, los tiempos de respuesta frente al umbral y los errores repetidos.
- *Programar sesión* → *Verificar servicios* (sin verificación no deja iniciar) → *Iniciar sesión*.
- *Registrar incidente* → *Marcar resuelto* → *Finalizar y generar reporte*: concurrencia máxima, tiempos de respuesta, incidentes y tiempo de solución.

## Qué reglas hace cumplir

| Regla | Dónde se ve | Requerimiento |
|---|---|---|
| La entidad solo sale del catálogo precargado | Formulario de estrategia | RQ_003 |
| Advertencia de nombre duplicado en la misma entidad, sin bloquear | Al guardar | RQ_003 |
| Fecha final posterior a la inicial y cupo mayor que cero | Al guardar (servidor) | RQ_003 |
| Bloqueo en la **misma transacción** que la primera vinculación | Diálogo de vinculación | RQ_004 |
| Edición rechazada en el servidor con 403; una edición si el tutor líder la aprueba | *Probar edición directa*, *Solicitudes* | RQ_004 |
| No se crean estudiantes; solo se vinculan los precargados | No existe esa operación | RQ_005 |
| Vinculación masiva atómica, con control de cupo y de duplicados | Vincular | RQ_005 |
| Desvinculación lógica con motivo de lista y fecha válida; sin estudiantes activos la estrategia vuelve a ser editable | Detalle de la estrategia | RQ_006 |
| Solo se acompaña a los docentes de la estrategia | Acompañamientos | RQ_007 |
| Sesión grupal: mínimo dos asistentes, un registro por asistente en una transacción | Acompañamientos | RQ_008 |
| La hora del registro la pone el servidor, no el cliente | Todo registro | RQ_007 |
| Semanas por calendario ISO, meses de 4 o 5 semanas | Seguimiento | RQ_009 |
| No se reportan semanas futuras; "sin actividad" no es "en blanco" | Seguimiento | RQ_009 |
| Cierre: no se cierra un periodo vacío, se exige justificación si falta algo, se marca extemporáneo y bloquea los registros | Seguimiento y cierre | RQ_010 |
| Reapertura aprobada por el tutor líder, con la versión cerrada conservada | Solicitudes | RQ_010 |
| Indicador de distribución temporal; preliminar mientras haya periodos abiertos | Tablero | RQ_011 |
| Solo se certifican periodos cerrados; exclusión con motivo; versiones inmutables con código de verificación | Reportes de ley | RQ_012 |
| Ente de control de solo lectura; consultas y descargas auditadas; certificado frente a preliminar | Reportes de control | RQ_013 |
| Carga por plantilla, rechazo completo si no corresponde, informe por fila | Cargas masivas | RQ_014 |
| Credenciales de activación, cambio obligatorio de contraseña, revocación con cierre inmediato de sesiones y reasignación | Usuarios | RQ_015, CU-01 |
| Verificación previa obligatoria, incidentes con escalamiento, reporte técnico | Monitoreo | RQ_016 |
| Control de acceso por perfil y ámbito aplicado en la consulta | Todo el API | RQ_001, RQ_002 |
| Auditoría de solo anexado, con valores previos | Auditoría | RQ_017 |

**Cómo se definen las semanas.** Semanas ISO (lunes a domingo). Una semana pertenece al mes en que cae su lunes: febrero de 2026 tiene cuatro y marzo cinco.

**Cómo se mide la oportunidad.**
- Un seguimiento es *a tiempo* si se registra a más tardar tres días después del domingo de su semana.
- Un acompañamiento es *a tiempo* si se registra hasta cinco días después de realizado.
- El periodo se cierra *a tiempo* hasta cinco días después del último día del mes.
- El patrón del mes se calcula así:
  - *Concentrado al cierre*: el 60 % o más de los seguimientos se registró en los últimos tres días del mes o después.
  - *Sostenido*: el 60 % o más se registró a tiempo.
  - *Irregular*: en cualquier otro caso.

## Tecnología

| Capa | Tecnología |
|---|---|
| Interfaz | Angular 17 + Angular Material |
| API | Node 22 + TypeScript + Express (REST, JWT) |
| Datos | PostgreSQL 16 |
| Empaquetado | Docker Compose: `db`, `api`, `web` (nginx) |
| Versión en línea | GitHub Pages: el API empaquetado con esbuild y PostgreSQL en WebAssembly (PGlite) |
| Pruebas | Vitest + Supertest |

Frente al marco tecnológico de la propuesta (numeral 2.6), el MVP reemplaza .NET 8 por Node/TypeScript en la capa de servicios. Se mantienen la interfaz, el motor de base de datos, el estilo REST, la autenticación con JWT y los contenedores.

```
api/
  sql/001_schema.sql      tablas, secuencia, índices y triggers de inmutabilidad (auditoría y reportes)
  src/domain/             lógica pura: semanas, cobertura, oportunidad
  src/modules/            seguridad, usuarios, auditoría, estrategias, vinculación, periodos,
                          acompañamiento, seguimiento, cierre, tablero, observaciones,
                          reportes, cargas, monitoreo
  src/seed.ts             datos sintéticos, relativos a la fecha en que se cargan
  test/                   pruebas con los identificadores de la matriz 2.9.4
  navegador/              versión en línea: reemplazos de express, pg, jsonwebtoken y node:crypto,
                          el worker de PGlite y el script que empaqueta todo para el navegador
web/
  src/app/core/           sesión, cliente del API, guardas, componentes compartidos
  src/app/paginas/        una pantalla por caso de uso
```

Los módulos del API son los del numeral 2.7 y respetan los diagramas de secuencia:
- Acompañamiento obtiene los docentes a través de Vinculación.
- Vinculación le pide a Estrategias ejecutar el bloqueo (y el desbloqueo) dentro de la misma transacción.
- El cierre consulta primero los acompañamientos y después la cobertura del seguimiento semanal.

## Pruebas

Requieren Node 20 o superior y la base de datos arriba (`docker compose up -d db`). Usan una base aparte, `sses_test`, que se crea sola, así que no tocan los datos de la demostración.

```
cd api
npm install
npm test
```

> **En Windows:** si vitest falla con "failed to find the runner", la terminal está en una ruta con la letra de unidad en minúscula (`c:\...`). Ábrala en la ruta con la letra en mayúscula, por ejemplo en PowerShell con `Set-Location 'C:\ruta\al\repo\api'`.

Son 83 casos en tres archivos:
- `unitarias`: lógica pura.
- `integracion`: el núcleo del MVP.
- `piloto-completo`: grupal, desvinculación, cierre y reapertura, solicitudes, reportes de ley, ente de control, usuarios, cargas, monitoreo y observaciones.

Los casos llevan los identificadores de la matriz del numeral 2.9.4: PU-01 a PU-04, PI-01 a PI-03, PF-01 a PF-04, PF-06 a PF-08, PF-12, PF-13, PF-16, PF-17, PA-03 y PS-03.

Las mismas 83 pruebas se pueden correr sobre PGlite, la base de la versión en línea. No necesitan Docker:

```
cd api
npm run test:navegador
```

## Desarrollo sin contenedores para el API y la interfaz

Con Node 20 o superior:

```
docker compose up -d db
cd api && npm install && npm run dev       # http://localhost:3000/api
cd web && npm install && npx ng serve      # http://localhost:4200
```

Antes hay que detener los contenedores `api` y `web` (`docker compose stop api web`), porque usan el mismo puerto 3000.

Para probar la versión en línea en el propio equipo, sin Docker:

```
cd api && npm install && npm run build:navegador      # deja el API empaquetado en web/api-navegador
cd web && npm install && npx ng build --configuration pages
```

El resultado queda en `web/dist/web/browser` y se sirve bajo la ruta `/SEES/`, igual que en GitHub Pages. La interfaz es la misma; la configuración `pages` solo cambia `src/app/core/modo.ts`, que hace que las peticiones a `/api` las atienda el API del navegador en lugar de la red.

## Simplificaciones frente al Piloto completo

- Las credenciales de activación se muestran una vez al administrador, en lugar de enviarse por correo. No hay recuperación de contraseña por enlace.
- No hay OpenID Connect ni refresh token. El token dura 4 horas, y la revocación igual cierra las sesiones de inmediato.
- Las métricas del monitoreo viven en la memoria del API, no en una plataforma de observabilidad. La alerta al Líder Técnico y el escalamiento quedan registrados, pero no se envían.
- Las descargas son CSV y se generan en línea, no de forma asíncrona.
- Fuera del MVP:
  - Adjuntar evidencias.
  - Operación sin conexión.
  - Notificaciones por correo.
  - Despliegue en la nube con un servidor real. La versión en línea de GitHub Pages es para que cualquiera pruebe el MVP: cada navegador tiene su propia base de datos.
