# Pitch del MVP — Piloto SSES

Guion para la sustentación: **10 minutos**. Cada bloque dice qué se hace en pantalla y qué se dice. Las frases entre comillas son una guía, no hay que leerlas al pie de la letra.

**Antes de empezar:**
- Reinicie los datos (`reiniciar-datos.cmd`) el mismo día.
- Abra **http://localhost:8080** en cinco pestañas, ya con sesión iniciada: `tutor1`, `lider`, `control`, `admin` y `soporte`. La contraseña de todos es `Sses2026*`.
- Para ahorrar tiempo, cree la estrategia de antemano en `tutor1`: cupo **10** e inicio el primer día del mes pasado, todavía **sin estudiantes**.
- Con `tutor3`, en *Seguimiento y cierre* del mes anterior, cierre el periodo de *Club de Lectura Crítica* con una justificación. Sin esto, el tutor líder no puede certificar el reporte de Caribe en el bloque 3.

| Bloque | Tiempo |
|---|---|
| 1. Apertura | 1 min |
| 2. Tutor | 3 min |
| 3. Tutor líder | 3 min |
| 4. Control, administrador y soporte | 2 min |
| 5. Cierre | 1 min |

---

## 1. Apertura (1 min)

> "Hoy el Ministerio no sabe si de verdad se acompañó a los docentes ni si el seguimiento se hizo semana a semana o se llenó el último día. El Piloto SSES resuelve eso, y se lo vamos a mostrar funcionando, con los cinco actores y datos sintéticos.
>
> Fíjense en dos cosas: la estrategia **se bloquea sola** al vincular el primer estudiante, y el tablero **distingue el registro sostenido del concentrado al cierre**."

## 2. Tutor (3 min) · pestaña `tutor1`

- Abrir la estrategia preparada → *Vincular estudiantes* → marcar 6 → el diálogo muestra **Editable → Bloqueada**.
- *Probar edición directa al servidor* → **HTTP 403**. *Solicitar modificación* la radica ante el tutor líder.
- *Acompañamientos*, mes anterior: solo aparecen los docentes de la estrategia. Registrar uno.
- *Seguimiento y cierre*: las semanas futuras del mes en curso no se pueden reportar. En el mes anterior, reportar una semana: queda marcada como registrada **N días después**.

> "El bloqueo ocurre en la misma transacción que la vinculación, y este 403 demuestra que lo hace cumplir el servidor, no la pantalla. El tutor acompaña a los docentes, que no son usuarios del sistema. La hora de cada registro la pone el servidor, y así sabemos cuándo se registró de verdad. Al final del mes el tutor cierra el periodo, y si cierra tarde queda marcado como extemporáneo."

## 3. Tutor líder (3 min) · pestaña `lider`

- *Tablero*, mes anterior:
  - *Semillero de Robótica* → **Sostenido**.
  - *Club de Lectura Crítica* → 100 % de cobertura, pero **Concentrado al cierre**.
- Clic en una fila → registro individual con autor, fecha y hora.
- *Solicitudes* → aprobar la modificación del paso 2. Habilita **una sola** edición.
- *Reportes de ley*, alcance *Caribe* → *Certificar*: queda congelado con su **código de verificación**.

> "Es el corazón del sistema: las dos estrategias tienen el 100 %, pero una se registró semana a semana y la otra se llenó de golpe el último día. Un reporte tradicional diría que las dos cumplieron. Solo se certifican periodos cerrados, y un reporte certificado no se puede modificar: si hay un ajuste, se crea una versión nueva y la anterior se conserva."

## 4. Control, administrador y soporte (2 min)

- `control`: *Reportes de control* → Caribe **certificado**, Andina **preliminar**.
  > "El ente de control ve todo el país, pero es de solo lectura, y cada consulta queda auditada."
- `admin`: *Auditoría* → aparecen el 403 y todo lo que acabamos de hacer.
  > "El administrador crea usuarios con credenciales de activación, revoca accesos reasignando las estrategias y hace cargas masivas con un informe fila por fila. La auditoría solo admite anexar: nadie la puede editar."
- `soporte`: la consola con los usuarios conectados y los tiempos de respuesta frente al umbral.
  > "Soporte verifica los servicios antes de cada sesión del pilotaje, registra los incidentes y genera el reporte técnico."

## 5. Cierre (1 min)

> "Recorrimos el ciclo completo con los cinco actores. Las reglas viven en el servidor y están respaldadas por **83 pruebas automáticas**, nombradas con los identificadores de nuestra matriz de pruebas. Lo que sigue para el Piloto completo es el inicio de sesión institucional, las notificaciones y el despliegue en la nube."

---

## Si sobra tiempo o preguntan

Estas funciones existen pero no entran en los 10 minutos; el guion completo está en el [README](README.md#guion-de-la-demostración):
- Rechazo por cupo y advertencia de nombre duplicado.
- Sesión grupal de acompañamiento.
- Cierre con justificación y reapertura del periodo.
- Desvinculación de estudiantes.
- Versión 2 de un reporte certificado.
- Observaciones a un tutor.
- Revocación de acceso con reasignación.
- Carga masiva.
- Incidentes del pilotaje.

**¿Por qué Node y no .NET?** El MVP prueba las reglas de negocio. Se mantienen Angular, PostgreSQL, REST con JWT y los contenedores; el Piloto se construye en .NET 8.

**¿Qué pasa si alguien edita la base de datos directamente?** La auditoría y los reportes certificados tienen triggers que rechazan cualquier UPDATE o DELETE.

**¿Cómo se sabe que un registro es tardío?** Por la marca de tiempo del servidor. Si el 60 % o más del seguimiento se registró en los últimos tres días del mes, el patrón es *concentrado al cierre*.

**¿Quién registra el acompañamiento?** El tutor. El tutor líder lo evalúa. Corregimos esa inconsistencia en el documento (ver [CORRECCIONES-PROPUESTA.md](CORRECCIONES-PROPUESTA.md)).
