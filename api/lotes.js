/*
 * Listar / crear / vaciar lotes del repositorio.
 *
 *   GET    -> índice de lotes
 *   POST   -> alta de un lote (metadatos + filas ya parseadas en el cliente)
 *   DELETE -> vacía todo el repositorio, incluidos los PDF en Blob
 */
const {
  requireAuth, loteKey, getIndex, setIndex, getRows, setRows,
  publicEntry, countFailed, kv
} = require('./_lib');

async function borrarBlobs(urls) {
  if (!urls || !urls.length) return;
  try {
    const { del } = require('@vercel/blob');
    await del(urls);
  } catch (err) {
    // Si Blob no está configurado o la baja falla, se sigue: no tiene
    // sentido dejar el lote a medio borrar en KV por un blob huérfano.
    console.error('No se pudieron borrar los PDF del lote:', err.message);
  }
}

async function blobUrlsDeLote(id) {
  const rows = await getRows(id);
  // varias filas comparten el mismo chunk, hay que deduplicar
  return [...new Set(rows.map((r) => r.blobUrl).filter(Boolean))];
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const index = await getIndex();
      res.status(200).json({ index: index.map(publicEntry) });
      return;
    }

    if (req.method === 'POST') {
      const { filename, convenio, cuenta, cuentaSiro, periodo, fileType, rows } = req.body || {};
      if (!filename || !Array.isArray(rows)) {
        res.status(400).json({ error: 'Falta filename o rows' });
        return;
      }
      if (!rows.length) {
        res.status(400).json({ error: 'El lote no tiene filas' });
        return;
      }

      const id = 'lote_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      let index = await getIndex();

      // Si ya había un lote con el mismo nombre de archivo se reemplaza,
      // borrando también sus PDF para no dejarlos huérfanos en Blob.
      const prior = index.filter((e) => e.filename === filename);
      for (const p of prior) {
        await borrarBlobs(await blobUrlsDeLote(p.id));
        await kv.del(loteKey(p.id));
      }
      if (prior.length) index = index.filter((e) => e.filename !== filename);

      await setRows(id, rows);

      index.push({
        id,
        filename,
        convenio: convenio || '',
        cuenta: cuenta || '',
        cuentaSiro: cuentaSiro || '',
        periodo: periodo || '',
        fileType: fileType || 'excel',
        rowCount: rows.length,
        failedCount: countFailed(rows),
        pdfCount: 0,
        uploadedAt: new Date().toISOString()
      });
      await setIndex(index);

      res.status(200).json({
        id,
        rowCount: rows.length,
        failedCount: countFailed(rows),
        reemplazo: prior.length > 0
      });
      return;
    }

    if (req.method === 'DELETE') {
      const index = await getIndex();
      for (const e of index) {
        await borrarBlobs(await blobUrlsDeLote(e.id));
        await kv.del(loteKey(e.id));
      }
      await setIndex([]);
      res.status(200).json({ ok: true, lotesBorrados: index.length });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
