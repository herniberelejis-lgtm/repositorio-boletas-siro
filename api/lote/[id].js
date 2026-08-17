/*
 * Operaciones sobre un lote puntual.
 *
 *   DELETE -> quita el lote y sus PDF
 *   GET    -> filas del lote que necesitan revisión manual
 *   PATCH  -> corrige a mano el afiliado de una fila (body: {cpe, page, afiliado})
 */
const {
  requireAuth, loteKey, getIndex, setIndex, getRows, setRows,
  publicRow, countFailed, kv
} = require('../_lib');
const SiroParse = require('../../siro-parse');

async function borrarBlobs(urls) {
  if (!urls || !urls.length) return;
  try {
    const { del } = require('@vercel/blob');
    await del(urls);
  } catch (err) {
    console.error('No se pudieron borrar los PDF del lote:', err.message);
  }
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  try {
    const { id } = req.query;
    if (!id) {
      res.status(400).json({ error: 'Falta el id del lote' });
      return;
    }

    if (req.method === 'DELETE') {
      const rows = await getRows(id);
      await borrarBlobs([...new Set(rows.map((r) => r.blobUrl).filter(Boolean))]);
      await kv.del(loteKey(id));

      const index = await getIndex();
      await setIndex(index.filter((e) => e.id !== id));

      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'GET') {
      const rows = await getRows(id);
      const pendientes = rows.filter((r) => !r.afiliado || r.revisar);
      res.status(200).json({ rows: pendientes.map(publicRow) });
      return;
    }

    if (req.method === 'PATCH') {
      const { cpe, page, afiliado } = req.body || {};
      const nuevo = SiroParse.normalizeAfiliado(afiliado);
      if (!nuevo) {
        res.status(400).json({ error: 'El afiliado tiene que ser un número mayor a cero' });
        return;
      }

      const rows = await getRows(id);
      const i = rows.findIndex((r) =>
        (cpe && r.cpe === cpe) || (page != null && r.page === page)
      );
      if (i === -1) {
        res.status(404).json({ error: 'No se encontró esa fila en el lote' });
        return;
      }

      rows[i] = {
        ...rows[i],
        afiliado: nuevo,
        revisar: '',
        corregidoAMano: new Date().toISOString()
      };
      await setRows(id, rows);

      // el índice cachea failedCount, hay que recalcularlo
      const index = await getIndex();
      const entry = index.find((e) => e.id === id);
      if (entry) {
        entry.failedCount = countFailed(rows);
        await setIndex(index);
      }

      res.status(200).json({ ok: true, row: publicRow(rows[i]) });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
