import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodIssueCode, z } from 'zod';

/** Error de negocio con código HTTP y un código legible por el cliente. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(mensaje);
  }
}

/** Permite usar manejadores async en Express 4 sin perder los errores. */
export function asincrono(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

// Mensajes de validación en español.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' || issue.received === 'null' ? 'Campo obligatorio' : 'Tipo de dato inválido' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum <= 1 ? 'Campo obligatorio' : `Debe tener al menos ${issue.minimum} caracteres` };
      if (issue.type === 'array') return { message: `Debe seleccionar al menos ${issue.minimum}` };
      return { message: `Debe ser mayor o igual a ${issue.minimum}` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `No puede superar ${issue.maximum} caracteres` };
      return { message: `Debe ser menor o igual a ${issue.maximum}` };
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Valor no permitido' };
    default:
      return { message: ctx.defaultError };
  }
});

export function manejadorDeErrores(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ codigo: err.codigo, mensaje: err.message, ...err.extra });
    return;
  }
  if (err instanceof ZodError) {
    const campos: Record<string, string> = {};
    for (const issue of err.issues) {
      const campo = issue.path.join('.') || '_';
      if (!campos[campo]) campos[campo] = issue.message;
    }
    res.status(400).json({
      codigo: 'VALIDACION',
      mensaje: 'Hay campos obligatorios sin diligenciar o con valores inválidos.',
      campos,
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo de la petición no es un JSON válido.' });
    return;
  }
  console.error('[error no controlado]', err);
  res.status(500).json({ codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado. Intente de nuevo.' });
}

/** Convierte un parámetro de ruta en entero positivo o responde 400. */
export function entero(valor: unknown, nombre: string): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError(400, 'PARAMETRO_INVALIDO', `El parámetro "${nombre}" no es válido.`);
  }
  return n;
}
