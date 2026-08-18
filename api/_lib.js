/*
 * Helpers compartidos por los endpoints. El nombre arranca con "_" para que
 * Vercel no lo publique como ruta.
 */
const { kv } = require('@vercel/kv');

const INDEX_KEY = 'siro-lotes-index';

// La contraseña sale de una variable de entorno. El valor por defecto
// mantiene andando los deploys que todavía no la configuraron, pero
// conviene definir APP_PASSWORD en Vercel y cambiarla ahí.
const APP_PASSWORD = process.env.APP_PASSWORD || 'Apross2026';

function requireAuth(req, res) {
  if (req.headers['x-app-password'] !== APP_PASSWORD) {
    res.status(401).json({ error: 'Contraseña incorrecta' });
    return false;
  }
  return true;
}

const loteKey = (id) => 'siro-lote:' + id;

const getIndex = async () => (await kv.get(INDEX_KEY)) || [];
const setIndex = (index) => kv.set(INDEX_KEY, index);
const getRows = async (id) => (await kv.get(loteKey(id))) || [];
const setRows = (id, rows) => kv.set(loteKey(id), rows);

/**
 * Proyección de una fila para mandar al navegador. Saca blobUrl: la URL del
 * blob es pública, así que no sale nunca del servidor — los PDF se sirven
 * por /api/boleta, que valida la contraseña.
 */
function publicRow(row) {
  return {
    cpe: row.cpe,
    afiliado: row.afiliado,
    identificador: row.identificador || '',
    nombre: row.nombre || '',
    importe: row.importe || '',
    vencimiento: row.vencimiento || '',
    vencimientosExtra: row.vencimientosExtra || [],
    periodo: row.periodo || '',
    link: row.link || '',
    page: row.page == null ? null : row.page,
    revisar: row.revisar || '',
    hasPdf: !!row.blobUrl
  };
}

/** Igual que publicRow pero para las entradas del índice de lotes. */
function publicEntry(entry) {
  const { blobUrls, ...rest } = entry;
  return rest;
}

function countFailed(rows) {
  return rows.filter((r) => !r.afiliado).length;
}

function countPdf(rows) {
  return rows.filter((r) => !!r.blobUrl).length;
}

/**
 * Si hay un Blob store conectado al proyecto.
 *
 * Vercel conecta Blob de dos formas según cuándo se creó el store:
 *   - la vieja, con un token fijo en BLOB_READ_WRITE_TOKEN;
 *   - la nueva, con BLOB_STORE_ID y autenticación por OIDC (el propio
 *     @vercel/blob la resuelve solo con VERCEL_OIDC_TOKEN, que Vercel
 *     inyecta cuando el proyecto tiene habilitado el acceso a las
 *     variables de entorno del sistema).
 * Alcanza con que exista cualquiera de las dos para que put()/del() function.
 */
function blobConfigurado() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

module.exports = {
  kv,
  INDEX_KEY,
  APP_PASSWORD,
  requireAuth,
  loteKey,
  getIndex,
  setIndex,
  getRows,
  setRows,
  publicRow,
  publicEntry,
  countFailed,
  countPdf,
  blobConfigurado
};
