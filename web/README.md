# SSES — Interfaz (Angular 17)

Interfaz del MVP del Piloto SSES. Cómo levantar el proyecto completo, los usuarios de demostración y el guion de la sustentación están en el [README principal](../README.md).

Para trabajar solo en la interfaz, con el API y la base de datos arriba:

```
npm install
npx ng serve      # http://localhost:4200, reenvía /api a http://localhost:3000 (proxy.conf.json)
npx ng build      # compilación de producción en dist/
```

Organización:

- `src/app/core/`: sesión, cliente del API, guardas de acceso, modelos y componentes compartidos.
- `src/app/paginas/`: una pantalla por caso de uso.
- `src/styles.scss`: tema de Angular Material y todo el estilo global.

La interfaz no tiene pruebas propias. Las reglas de negocio se prueban en el API (`api/test`).
