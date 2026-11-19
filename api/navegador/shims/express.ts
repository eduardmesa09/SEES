/**
 * Enrutador mínimo con la misma semántica que Express para lo que usa el API:
 * capas en orden, `use` sin ruta, parámetros `:nombre`, `next(error)` y manejador de errores.
 * Solo se usa en la versión que corre en el navegador (GitHub Pages).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Request = any;
export type Response = any;
export type NextFunction = (error?: unknown) => void;
export type RequestHandler = (req: Request, res: Response, next: NextFunction) => void;

interface Capa {
  metodo: string | null; // null = use
  patron: RegExp | null; // null = cualquier ruta
  nombres: string[];
  manejadores: RequestHandler[];
}

function compilar(ruta: string): { patron: RegExp; nombres: string[] } {
  const nombres: string[] = [];
  const fuente = ruta
    .split('/')
    .map((parte) => {
      if (parte.startsWith(':')) {
        nombres.push(parte.slice(1));
        return '([^/]+)';
      }
      return parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { patron: new RegExp(`^${fuente}/?$`), nombres };
}

export interface Enrutador {
  get(ruta: string, ...m: RequestHandler[]): void;
  post(ruta: string, ...m: RequestHandler[]): void;
  put(ruta: string, ...m: RequestHandler[]): void;
  patch(ruta: string, ...m: RequestHandler[]): void;
  delete(ruta: string, ...m: RequestHandler[]): void;
  use(...m: RequestHandler[]): void;
  /** Recorre las capas; `fin` recibe el error pendiente, o nada si ninguna respondió. */
  manejar(req: Request, res: Response, fin: (error?: unknown) => void): void;
}

export function Router(): Enrutador {
  const capas: Capa[] = [];
  const agregar = (metodo: string) => (ruta: string, ...manejadores: RequestHandler[]) => {
    const { patron, nombres } = compilar(ruta);
    capas.push({ metodo, patron, nombres, manejadores });
  };
  return {
    get: agregar('GET'),
    post: agregar('POST'),
    put: agregar('PUT'),
    patch: agregar('PATCH'),
    delete: agregar('DELETE'),
    use: (...manejadores) => capas.push({ metodo: null, patron: null, nombres: [], manejadores }),
    manejar(req, res, fin) {
      const pila: { manejador: RequestHandler; params: Record<string, string> }[] = [];
      for (const capa of capas) {
        if (capa.metodo && capa.metodo !== req.method) continue;
        let params: Record<string, string> = {};
        if (capa.patron) {
          const m = capa.patron.exec(req.path);
          if (!m) continue;
          params = Object.fromEntries(capa.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        }
        for (const manejador of capa.manejadores) pila.push({ manejador, params });
      }
      let i = 0;
      const siguiente: NextFunction = (error) => {
        if (error !== undefined && error !== null) return fin(error);
        if (res.terminada) return;
        const capa = pila[i++];
        if (!capa) return fin();
        req.params = capa.params;
        try {
          capa.manejador(req, res, siguiente);
        } catch (e) {
          fin(e);
        }
      };
      siguiente();
    },
  };
}

export default { Router };
