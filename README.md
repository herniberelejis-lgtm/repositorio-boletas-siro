# Repositorio de Boletas SIRO (APROSS)

Buscador de boletas/cupones de pago SIRO por número de afiliado, con
repositorio compartido (Vercel KV) y carga de Excel (SIRO) o PDF (cupones).

## Requisitos para que funcione en Vercel

1. Conectar una base de datos **Vercel KV** al proyecto (Storage → Create
   Database → KV → Connect to Project). Sin esto, la app no tiene dónde
   guardar los lotes cargados.
2. La contraseña de acceso está hardcodeada en `api/*.js` como
   `APP_PASSWORD` — para cambiarla, editar ese valor y redeployar.

## Desarrollo local con Vercel CLI

```
npm i -g vercel
vercel link
vercel env pull .env.local
vercel dev
```

## Estructura

- `index.html` — frontend (búsqueda + modo administrador de carga)
- `api/lotes.js` — listar / crear / vaciar lotes (GET / POST / DELETE)
- `api/lote/[id].js` — borrar un lote puntual
- `api/search.js` — búsqueda de afiliados contra todos los lotes
