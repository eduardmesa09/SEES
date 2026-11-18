-- =====================================================================
-- Piloto SSES - MVP. Esquema de datos.
-- Las tablas siguen los nombres usados en los requerimientos (numeral 2.6).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Catálogos precargados (CU-14: por el seed o por carga masiva) ----------

CREATE TABLE entidad (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  municipio   TEXT NOT NULL,
  territorio  TEXT NOT NULL
);

CREATE TABLE estudiante (
  id               SERIAL PRIMARY KEY,
  tipo_documento   TEXT NOT NULL,
  documento        TEXT NOT NULL UNIQUE,
  nombres          TEXT NOT NULL,
  apellidos        TEXT NOT NULL,
  nombre_busqueda  TEXT NOT NULL,           -- nombre normalizado (sin tildes, minúsculas)
  grado            TEXT NOT NULL,
  entidad_id       INT  NOT NULL REFERENCES entidad(id)
);
-- RQ_005 / RQ_019: la búsqueda por documento, nombre o entidad se resuelve con índices.
CREATE INDEX idx_estudiante_entidad ON estudiante (entidad_id, grado);
CREATE INDEX idx_estudiante_documento ON estudiante (documento text_pattern_ops);
CREATE INDEX idx_estudiante_nombre ON estudiante USING gin (nombre_busqueda gin_trgm_ops);

CREATE TABLE docente (
  id          SERIAL PRIMARY KEY,
  documento   TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  area        TEXT NOT NULL,
  entidad_id  INT  NOT NULL REFERENCES entidad(id)
);
CREATE INDEX idx_docente_entidad ON docente (entidad_id);

-- ---------- Seguridad y acceso (RQ_001, RQ_002) ----------

CREATE TABLE usuario (
  id                 SERIAL PRIMARY KEY,
  documento          TEXT NOT NULL UNIQUE,
  nombre             TEXT NOT NULL,
  correo             TEXT NOT NULL UNIQUE,
  hash_contrasena    TEXT NOT NULL,
  perfil             TEXT NOT NULL CHECK (perfil IN ('TUTOR', 'TUTOR_LIDER', 'ENTE_CONTROL', 'ADMIN', 'SOPORTE')),
  estado             TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO', 'BLOQUEADO')),
  intentos_fallidos  INT  NOT NULL DEFAULT 0,
  ultimo_acceso      TIMESTAMPTZ,
  -- CU-01: con credenciales de activación debe definir su propia contraseña antes de operar.
  debe_cambiar_contrasena BOOLEAN NOT NULL DEFAULT FALSE,
  -- CU-14: al revocar o cambiar perfil o ámbito se incrementa, y los tokens emitidos antes dejan de valer.
  version_sesion     INT  NOT NULL DEFAULT 1,
  motivo_estado      TEXT,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ámbito del usuario: entidades sobre las que puede trabajar.
-- Tutor: entidades donde puede crear estrategias. Tutor líder: entidades de su territorio.
CREATE TABLE ambito_usuario (
  usuario_id  INT NOT NULL REFERENCES usuario(id),
  entidad_id  INT NOT NULL REFERENCES entidad(id),
  PRIMARY KEY (usuario_id, entidad_id)
);

-- ---------- Estrategias estudiantiles (RQ_003, RQ_004) ----------

CREATE SEQUENCE estrategia_consecutivo_seq;

CREATE TABLE estrategia (
  id                  SERIAL PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  entidad_id          INT  NOT NULL REFERENCES entidad(id),   -- solo del catálogo precargado
  nombre              TEXT NOT NULL,
  nombre_normalizado  TEXT NOT NULL,
  objetivo            TEXT NOT NULL,
  modalidad           TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL', 'VIRTUAL', 'MIXTA')),
  fecha_inicio        DATE NOT NULL,
  fecha_fin           DATE NOT NULL,
  cupo_maximo         INT  NOT NULL CHECK (cupo_maximo > 0),
  estado              TEXT NOT NULL DEFAULT 'EDITABLE' CHECK (estado IN ('EDITABLE', 'BLOQUEADA')),
  version             INT  NOT NULL DEFAULT 1,
  creado_por          INT  NOT NULL REFERENCES usuario(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  bloqueada_en        TIMESTAMPTZ,
  -- Solicitud de modificación aprobada por el tutor líder: habilita una sola edición de la estrategia bloqueada.
  edicion_autorizada  BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_estrategia_fechas CHECK (fecha_fin > fecha_inicio)
);
CREATE INDEX idx_estrategia_entidad_nombre ON estrategia (entidad_id, nombre_normalizado);

-- Versión anterior de la estrategia en cada modificación (CU-03).
CREATE TABLE estrategia_version (
  id              SERIAL PRIMARY KEY,
  estrategia_id   INT NOT NULL REFERENCES estrategia(id),
  version         INT NOT NULL,
  datos           JSONB NOT NULL,
  modificado_por  INT NOT NULL REFERENCES usuario(id),
  modificado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE estrategia_tutor (
  estrategia_id  INT NOT NULL REFERENCES estrategia(id),
  usuario_id     INT NOT NULL REFERENCES usuario(id),
  PRIMARY KEY (estrategia_id, usuario_id)
);
CREATE INDEX idx_estrategia_tutor_usuario ON estrategia_tutor (usuario_id);

CREATE TABLE estrategia_docente (
  estrategia_id  INT NOT NULL REFERENCES estrategia(id),
  docente_id     INT NOT NULL REFERENCES docente(id),
  PRIMARY KEY (estrategia_id, docente_id)
);

CREATE TABLE solicitud_modificacion (
  id                   SERIAL PRIMARY KEY,
  estrategia_id        INT  NOT NULL REFERENCES estrategia(id),
  solicitado_por       INT  NOT NULL REFERENCES usuario(id),
  cambios_solicitados  TEXT NOT NULL,
  justificacion        TEXT NOT NULL,
  estado               TEXT NOT NULL DEFAULT 'RADICADA' CHECK (estado IN ('RADICADA', 'APROBADA', 'RECHAZADA', 'APLICADA')),
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_por         INT  REFERENCES usuario(id),
  resuelto_en          TIMESTAMPTZ,
  respuesta            TEXT
);

-- ---------- Vinculación de estudiantes (RQ_005) ----------

CREATE TABLE vinculacion_estudiante (
  id                 SERIAL PRIMARY KEY,
  estrategia_id      INT  NOT NULL REFERENCES estrategia(id),
  estudiante_id      INT  NOT NULL REFERENCES estudiante(id),
  estado             TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'INACTIVA')),
  fecha_vinculacion  DATE NOT NULL,
  vinculado_por      INT  NOT NULL REFERENCES usuario(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- RQ_006: la desvinculación es lógica; la historia de participación se conserva.
  fecha_desvinculacion   DATE,
  motivo_desvinculacion  TEXT,
  desvinculado_por       INT REFERENCES usuario(id),
  desvinculado_en        TIMESTAMPTZ,
  -- RQ_005: la vinculación duplicada se rechaza por restricción de unicidad.
  CONSTRAINT uq_vinculacion UNIQUE (estrategia_id, estudiante_id)
);

-- ---------- Acompañamiento pedagógico y seguimiento semanal (RQ_007, RQ_009) ----------

CREATE TABLE periodo_mensual (
  id             SERIAL PRIMARY KEY,
  estrategia_id  INT  NOT NULL REFERENCES estrategia(id),
  anio           INT  NOT NULL,
  mes            INT  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado         TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'CERRADO')),
  -- CU-10 / RQ_010: cierre con autor, fecha y justificación; reapertura con versión conservada.
  cerrado_por           INT  REFERENCES usuario(id),
  cerrado_en            TIMESTAMPTZ,
  justificacion_cierre  TEXT,
  extemporaneo          BOOLEAN NOT NULL DEFAULT FALSE,
  resumen_cierre        JSONB,
  corregido             BOOLEAN NOT NULL DEFAULT FALSE,
  version               INT  NOT NULL DEFAULT 1,
  CONSTRAINT uq_periodo UNIQUE (estrategia_id, anio, mes)
);

-- Cada cierre que se reabre queda conservado tal como estaba (RQ_010).
CREATE TABLE periodo_version (
  id            SERIAL PRIMARY KEY,
  periodo_id    INT  NOT NULL REFERENCES periodo_mensual(id),
  version       INT  NOT NULL,
  datos         JSONB NOT NULL,
  reabierto_por INT  NOT NULL REFERENCES usuario(id),
  reabierto_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE solicitud_reapertura (
  id              SERIAL PRIMARY KEY,
  periodo_id      INT  NOT NULL REFERENCES periodo_mensual(id),
  solicitado_por  INT  NOT NULL REFERENCES usuario(id),
  motivo          TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'RADICADA' CHECK (estado IN ('RADICADA', 'APROBADA', 'RECHAZADA')),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_por    INT  REFERENCES usuario(id),
  resuelto_en     TIMESTAMPTZ,
  respuesta       TEXT
);

-- CU-08 / RQ_008: una jornada colectiva genera un acompañamiento por cada docente asistente.
CREATE TABLE sesion_grupal (
  id              SERIAL PRIMARY KEY,
  periodo_id      INT  NOT NULL REFERENCES periodo_mensual(id),
  estrategia_id   INT  NOT NULL REFERENCES estrategia(id),
  fecha           DATE NOT NULL,
  modalidad       TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL', 'VIRTUAL', 'MIXTA')),
  tema            TEXT NOT NULL,
  registrado_por  INT  NOT NULL REFERENCES usuario(id),
  registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE acompanamiento (
  id                    SERIAL PRIMARY KEY,
  periodo_id            INT  NOT NULL REFERENCES periodo_mensual(id),
  estrategia_id         INT  NOT NULL REFERENCES estrategia(id),
  docente_id            INT  NOT NULL REFERENCES docente(id),
  tipo                  TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (tipo IN ('INDIVIDUAL', 'GRUPAL')),
  fecha                 DATE NOT NULL,
  modalidad             TEXT NOT NULL CHECK (modalidad IN ('PRESENCIAL', 'VIRTUAL', 'MIXTA')),
  tema                  TEXT NOT NULL,
  observaciones         TEXT NOT NULL,
  compromisos           TEXT NOT NULL,
  avance_compromisos    TEXT,
  sesion_grupal_id      INT  REFERENCES sesion_grupal(id),
  registrado_por        INT  NOT NULL REFERENCES usuario(id),
  -- RQ_007: marca de tiempo del servidor, de ella depende la medición de oportunidad.
  registrado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_acompanamiento_periodo ON acompanamiento (periodo_id, docente_id);

CREATE TABLE seguimiento_semanal (
  id                   SERIAL PRIMARY KEY,
  periodo_id           INT  NOT NULL REFERENCES periodo_mensual(id),
  estrategia_id        INT  NOT NULL REFERENCES estrategia(id),
  anio_iso             INT  NOT NULL,
  semana_iso           INT  NOT NULL,
  inicio_semana        DATE NOT NULL,
  fin_semana           DATE NOT NULL,
  sin_actividad        BOOLEAN NOT NULL DEFAULT FALSE,
  causa_inactividad    TEXT,
  actividades          TEXT,
  avance_compromisos   TEXT,
  dificultades         TEXT,
  acciones             TEXT,
  registrado_por       INT  NOT NULL REFERENCES usuario(id),
  registrado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en       TIMESTAMPTZ,
  version              INT  NOT NULL DEFAULT 1,
  CONSTRAINT uq_seguimiento UNIQUE (estrategia_id, anio_iso, semana_iso)
);
CREATE INDEX idx_seguimiento_periodo ON seguimiento_semanal (periodo_id);

-- ---------- Observaciones del tutor líder al tutor (CU-11) ----------

CREATE TABLE observacion (
  id             SERIAL PRIMARY KEY,
  tutor_id       INT  NOT NULL REFERENCES usuario(id),
  autor_id       INT  NOT NULL REFERENCES usuario(id),
  estrategia_id  INT  REFERENCES estrategia(id),
  anio           INT  NOT NULL,
  mes            INT  NOT NULL,
  texto          TEXT NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  leida_en       TIMESTAMPTZ
);
CREATE INDEX idx_observacion_tutor ON observacion (tutor_id, creado_en DESC);

-- ---------- Reportes de ley certificados (CU-12, RQ_012) ----------

-- Cada certificación es una versión inmutable; una recertificación crea otra fila, nunca actualiza.
CREATE TABLE reporte_certificado (
  id                   SERIAL PRIMARY KEY,
  tipo                 TEXT NOT NULL,
  anio                 INT  NOT NULL,
  mes                  INT  NOT NULL,
  alcance              TEXT NOT NULL,
  version              INT  NOT NULL,
  datos                JSONB NOT NULL,
  exclusiones          JSONB NOT NULL DEFAULT '[]'::jsonb,
  motivo_ajuste        TEXT,
  codigo_verificacion  TEXT NOT NULL UNIQUE,
  certificado_por      INT  NOT NULL REFERENCES usuario(id),
  certificado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_reporte_version UNIQUE (tipo, anio, mes, alcance, version)
);

-- ---------- Cargas masivas (CU-14, RQ_014) ----------

CREATE TABLE carga_masiva (
  id           SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('ENTIDADES', 'ESTUDIANTES', 'DOCENTES')),
  archivo      TEXT NOT NULL,
  filas        INT  NOT NULL,
  aceptados    INT  NOT NULL,
  rechazados   INT  NOT NULL,
  informe      JSONB NOT NULL,
  cargado_por  INT  NOT NULL REFERENCES usuario(id),
  cargado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Sesiones del pilotaje e incidentes (CU-15, RQ_016) ----------

CREATE TABLE sesion_pilotaje (
  id             SERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'PROGRAMADA'
                 CHECK (estado IN ('PROGRAMADA', 'RETRASADA', 'INICIADA', 'FINALIZADA', 'SUSPENDIDA')),
  verificacion   JSONB,
  verificada_en  TIMESTAMPTZ,
  causa_retraso  TEXT,
  iniciada_en    TIMESTAMPTZ,
  finalizada_en  TIMESTAMPTZ,
  causa_cierre   TEXT,
  reporte        JSONB,
  creada_por     INT  NOT NULL REFERENCES usuario(id),
  creada_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incidente (
  id                 SERIAL PRIMARY KEY,
  sesion_id          INT  NOT NULL REFERENCES sesion_pilotaje(id),
  ocurrido_en        TIMESTAMPTZ NOT NULL,
  usuario_afectado   TEXT NOT NULL,
  region             TEXT NOT NULL,
  descripcion        TEXT NOT NULL,
  accion             TEXT NOT NULL,
  completo_registro  BOOLEAN NOT NULL,
  resuelto_en        TIMESTAMPTZ,
  registrado_por     INT  NOT NULL REFERENCES usuario(id),
  registrado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Auditoría inmutable (RQ_017) ----------

CREATE TABLE auditoria (
  id                BIGSERIAL PRIMARY KEY,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id        INT REFERENCES usuario(id),
  usuario_correo    TEXT,
  operacion         TEXT NOT NULL,
  entidad_afectada  TEXT NOT NULL,
  registro_id       TEXT,
  valores_previos   JSONB,
  valores_nuevos    JSONB,
  detalle           TEXT,
  ip                TEXT
);
CREATE INDEX idx_auditoria_fecha ON auditoria (fecha DESC);

-- Política de solo anexado: ningún perfil puede actualizar ni borrar la traza.
CREATE FUNCTION auditoria_solo_anexado() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla de auditoria es de solo anexado: no admite % (RQ_017)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_solo_anexado();

CREATE TRIGGER trg_auditoria_sin_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_solo_anexado();

-- La certificación congela el reporte: tampoco admite cambios ni borrado (RQ_012).
CREATE TRIGGER trg_reporte_inmutable
  BEFORE UPDATE OR DELETE ON reporte_certificado
  FOR EACH ROW EXECUTE FUNCTION auditoria_solo_anexado();
