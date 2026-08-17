/*
 * Diagnóstico de la configuración del proyecto en Vercel.
 *
 *   GET /api/estado
 *
 * Dice qué piezas están conectadas —KV, Blob, la contraseña— para poder
 * confirmar el setup sin tener que cargar un lote y ver si falla. No
 * devuelve ningún secreto: sólo si cada cosa está o no configurada.
 */
const { requireAuth, kv, INDEX_KEY } = require('./_lib');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const estado = {
    kv: { ok: false, detalle: '' },
    blob: { ok: false, detalle: '' },
    password: { desdeEnv: false, detalle: '' }
  };

  // KV: no alcanza con que exista la variable de entorno, hay que leer algo
  try {
    const index = (await kv.get(INDEX_KEY)) || [];
    estado.kv.ok = true;
    estado.kv.detalle = index.length
      ? index.length + ' lote' + (index.length === 1 ? '' : 's') + ' guardados'
      : 'conectado, repositorio vacío';
  } catch (err) {
    estado.kv.detalle = 'no se pudo leer: ' + err.message;
  }

  // Blob: alcanza con el token, el put real se prueba al cargar un PDF
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    estado.blob.ok = true;
    estado.blob.detalle = 'conectado, los PDF se pueden guardar';
  } else {
    estado.blob.detalle = 'sin conectar: los lotes quedan sólo con el link de pago';
  }

  estado.password.desdeEnv = !!process.env.APP_PASSWORD;
  estado.password.detalle = estado.password.desdeEnv
    ? 'tomada de APP_PASSWORD'
    : 'usando la contraseña por defecto del código — conviene definir APP_PASSWORD';

  estado.listo = estado.kv.ok && estado.blob.ok && estado.password.desdeEnv;
  res.status(200).json(estado);
};
