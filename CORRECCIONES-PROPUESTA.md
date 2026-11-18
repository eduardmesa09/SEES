# Correcciones a la propuesta técnica (Piloto SSES)

Ajustes al documento de NovaTech Asociados para que los actores sean coherentes con el pliego del Ministerio y entre secciones.

> **Estado.** Las correcciones de texto ya están aplicadas en `MateriaJueves_ParcialFinalCorregido.docx`, sin cambios de estilo. Falta revisar a mano los **diagramas** del numeral 2.8, porque son imágenes (ver la sección 2.8 más abajo).

## El problema

El pliego distingue dos poblaciones:

- **Docentes**: profesores de las instituciones. Están "previamente registrados y asociados" a las estrategias y **reciben** el acompañamiento pedagógico. No son usuarios del sistema.
- **Tutores**: son los usuarios del Piloto. **Realizan** el acompañamiento, y el sistema debe "evaluar el desempeño de los tutores".

La propuesta tiene tres inconsistencias:

1. En 2.2 dice "docentes (o tutores)" y en HU-05 dice "tutores (docentes)", como si fueran la misma persona.
2. El actor del acompañamiento cambia de una sección a otra. HU-05, HU-06, CU-07 y CU-08 dicen **Tutor líder**. RQ_007 y RQ_008, y el propio texto de CU-07 y CU-08 ("el tutor selecciona..."), dicen **Tutor**.
3. Se siguen usando los nombres viejos **gestor** y **analista** (y "Analista de Seguimiento") para los actores que en 2.2 se llaman Tutor y Tutor líder.

Si el tutor líder registra los acompañamientos, el tablero de CU-11 termina midiendo al tutor líder y no a los tutores, y eso contradice el pliego.

## Decisión

| Actor | Qué hace en el Piloto |
|---|---|
| **Tutor** | Crea y modifica estrategias, vincula y desvincula estudiantes, **registra los acompañamientos individuales y grupales a los docentes de sus estrategias**, reporta el seguimiento semanal y cierra el periodo mensual. |
| **Tutor líder** | Consulta el cumplimiento y evalúa el desempeño de los tutores, genera observaciones, decide las reaperturas de periodo y las solicitudes de modificación, y genera y certifica los reportes de ley. |
| **Docente** | No es usuario. Es el profesor de la institución que recibe el acompañamiento. |

Equivalencias para todo el documento: **gestor = Tutor**, **analista / Analista de Seguimiento = Tutor líder**.

## Cambios uno por uno

### 2.2 Actores del sistema

| Fila | Dice | Debe decir |
|---|---|---|
| Tutor | "Profesional que crea las estrategias estudiantiles asociadas a las entidades definidas, las modifica mientras no tengan estudiantes vinculados y vincula los estudiantes." | "Profesional que crea las estrategias estudiantiles asociadas a las entidades definidas, las modifica mientras no tengan estudiantes vinculados, vincula los estudiantes y **realiza y registra los acompañamientos pedagógicos a los docentes asociados a sus estrategias**, con su seguimiento semanal y el cierre del periodo mensual." |
| Tutor líder | "Realiza y registra los acompañamientos pedagógicos a los docentes (o tutores). Consulta el cumplimiento y evalúa el desempeño de las actividades." | "**Supervisa a los tutores de su territorio**: consulta el cumplimiento y evalúa el desempeño de los tutores y de las actividades, decide las reaperturas de periodo y genera y certifica los reportes de ley." |

Opcional: agregar una nota bajo la tabla. "Los docentes no son usuarios del Piloto: son los profesores de las instituciones, precargados y asociados a las estrategias, que reciben el acompañamiento pedagógico."

### 2.4 Historias de usuario

| Dónde | Dice | Debe decir |
|---|---|---|
| HU-05, campo Actor | Tutor líder | **Tutor** |
| HU-05, descripción | "Yo, como tutor líder, ingreso al Piloto cada mes para dejar registrado el acompañamiento que le hice a cada uno de los **tutores (docentes)** que tengo asignados." | "Yo, como tutor, ingreso al Piloto cada mes para dejar registrado el acompañamiento que le hice a cada uno de los **docentes** que tengo asignados." |
| HU-06, campo Actor | Tutor líder | **Tutor** |
| HU-06, descripción | "Yo, como tutor líder, ingreso al Piloto cuando el acompañamiento que realicé no fue a un solo docente…" | "Yo, como tutor, ingreso al Piloto cuando el acompañamiento que realicé no fue a un solo docente…" |
| HU-08, descripción | "…esa solicitud va al **Analista de Seguimiento** del Ministerio, que es quien decide…" | "…esa solicitud va al **tutor líder**, que es quien decide…" |
| HU-12, descripción | "Registro a cada tutor, analista, gestor y funcionario del ente de control…" y "…un analista alcance las de su territorio." | "Registro a cada tutor, tutor líder y funcionario del ente de control…" y "…un tutor líder alcance las de su territorio." |

### 2.5 Casos de uso

| Dónde | Dice | Debe decir |
|---|---|---|
| CU-01, descripción | "…el gestor alcanza las estrategias de las entidades bajo su responsabilidad, el analista alcanza las de su territorio…" | "…el tutor alcanza únicamente las estrategias que tiene asignadas, el tutor líder alcanza las de su territorio…" (eliminar la frase del gestor, que queda repetida) |
| CU-02 y CU-03, descripción | "el gestor" (varias veces) | "el tutor" |
| CU-04, descripción | "…que para el gestor son las de las entidades bajo su responsabilidad y para el analista las de su territorio." | "…que para el tutor son las estrategias que tiene asignadas y para el tutor líder las de su territorio." |
| CU-05 y CU-06, descripción | "el gestor" (varias veces) | "el tutor" |
| CU-07, campo Actor | Tutor líder | **Tutor** |
| CU-07, descripción | "…solicitud de reapertura dirigida al **Analista de Seguimiento**…" | "…solicitud de reapertura dirigida al **tutor líder**…" |
| CU-08, campo Actor | Tutor líder | **Tutor** |
| CU-09, descripción | "…tramitarse la reapertura ante el **Analista de Seguimiento**." | "…tramitarse la reapertura ante el **tutor líder**." |
| CU-10, descripción | "…la cual se dirige al **Analista de Seguimiento**…" | "…la cual se dirige al **tutor líder**…" |
| CU-11, descripción | "El analista selecciona…", "el analista puede descender…", "Si el analista consulta…", "Si el analista detecta…" | "El tutor líder…" en todos los casos |
| CU-12, descripción | "El analista selecciona el reporte…", "El analista revisa, certifica…", "el analista puede entonces esperar…", "Si el analista solicita…" | "El tutor líder…" en todos los casos |
| CU-14, descripción | "…registra a cada tutor, gestor, analista y funcionario de control…" | "…registra a cada tutor, tutor líder y funcionario del ente de control…" |

### 2.6 Requerimientos

| Dónde | Dice | Debe decir |
|---|---|---|
| RQ_007, campo Actor | Tutor | Sin cambio (ya está bien) |
| RQ_008, campo Actor | Tutor | Sin cambio (ya está bien) |
| RQ_010, descripción | "La reapertura debe requerir aprobación del perfil **Analista**…" | "La reapertura debe requerir aprobación del perfil **Tutor líder**…" |

### 2.8 Diagramas UML

| Dónde | Dice | Debe decir |
|---|---|---|
| Texto del diagrama de secuencia de vinculación | "El mensaje final hacia el **gestor** informa…" | "El mensaje final hacia el **tutor** informa…" |
| Diagramas de secuencia de RQ_007, RQ_008 y cierre de periodo (imágenes) | Revisar el nombre del actor (lifeline) | Debe ser **Tutor** |
| Diagrama de clases (imagen) | Revisar si aparecen perfiles Gestor o Analista | Usar TUTOR, TUTOR_LIDER, ENTE_CONTROL, ADMIN y SOPORTE |

### 2.9.4 Matriz de pruebas

| Dónde | Dice | Debe decir |
|---|---|---|
| PF-01, precondición | "Entidad precargada y perfil **Gestor**" | "Entidad precargada y perfil **Tutor**" |

## Otra inconsistencia del mismo tipo

| Dónde | Dice | Debe decir |
|---|---|---|
| CU-06, descripción | "Si **el estudiante** aparece en acompañamientos grupales registrados con fecha posterior a la desvinculación…" y "…conserva íntegra toda su participación previa incluidos los acompañamientos grupales en los que estuvo presente…" | Los acompañamientos grupales son a **docentes**, no a estudiantes, así que un estudiante no aparece en ellos. Hay que eliminar ese flujo alterno y la mención a los acompañamientos grupales. El resto del CU-06 queda igual: motivo de la lista, fecha no anterior a la vinculación ni futura, y la estrategia vuelve a ser editable si queda sin estudiantes activos. El MVP lo implementa así. |

## Lo que no hay que cambiar

- "Analista Funcional", "Gestor del Pilotaje", "gestor de defectos", "analista QA" y la respuesta sobre quién define la línea base. Son **roles del equipo del proyecto** o herramientas, no actores del sistema.
- RQ_007, RQ_008, CU-09 y CU-10: ya dicen **Tutor**.
- HU-09, HU-10, CU-11, CU-12 y RQ_011, RQ_012: el actor ya es **Tutor líder**. Solo cambia la palabra "analista" dentro del texto.
- Numeral 3.8 (MVP): no nombra el actor del acompañamiento, así que queda bien.

## Cómo queda en el MVP

El MVP ya aplica esta corrección:

- El tutor registra los acompañamientos individuales y grupales.
- El servidor rechaza con 403 al tutor líder si intenta registrar un acompañamiento.
- El tablero evalúa a cada tutor por los acompañamientos que él mismo registró.
