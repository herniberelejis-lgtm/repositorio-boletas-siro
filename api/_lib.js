/*
 * Helpers compartidos por los endpoints. El nombre arranca con "_" para que
 * Vercel no lo publique como ruta.
 */

// -------------------------------------------------------------------------
// KV
// -------------------------------------------------------------------------
// El producto nativo "Vercel KV" (REST + KV_REST_API_URL/TOKEN, que era lo
// que pedía @vercel/kv) ya no es lo que ofrece Vercel al conectar una base
// desde Storage: ahora es un Marketplace de integraciones, y la que se
// conectó en este proyecto da una única REDIS_URL — una conexión Redis
// común, por TCP, no la API REST de Upstash. Por eso se habla con ioredis
// en lugar de @vercel/kv, con una envoltura mínima (get/set/del) que
// serializa a JSON para no tener que tocar el resto del código: todo lo
// demás sigue llamando a kv.get/kv.set/kv.del exactamente igual.
const Redis = require('ioredis');

let _redis = null;
function redisClient() {
  if (!_redis) {
    const url = process.env.REDIS_URL || process.env.KV_URL;
    if (!url) throw new Error('Falta REDIS_URL en las variables de entorno');
    _redis = new Redis(url, { maxRetriesPerRequest: 3 });
    _redis.on('error', (err) => console.error('Redis:', err.message));
  }
  return _redis;
}

const kv = {
  async get(key) {
    const raw = await redisClient().get(key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },
  async set(key, value) {
    return redisClient().set(key, JSON.stringify(value));
  },
  async del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (!flat.length) return 0;
    return redisClient().del(...flat);
  }
};

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
