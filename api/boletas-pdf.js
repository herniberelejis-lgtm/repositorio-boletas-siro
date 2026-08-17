/*
 * Guarda en Vercel Blob las páginas de un lote de cupones ya creado, y
 * anota en KV dónde quedó cada boleta.
 *
 * El navegador manda las páginas por tandas ("chunks") de un PDF con
 * varias boletas adentro, en lugar de un PDF por boleta, por dos razones:
 *
 *   - El body de una función de Vercel no puede pasar de 4,5 MB, así que
 *     un lote grande no entra en un solo request.
 *   - Las páginas de un mismo PDF comparten las fuentes embebidas. Medido
 *     sobre un cupón real de 40 páginas: partirlo de a una da 183 KB por
 *     boleta, y de a 25 da 53 KB — el mismo peso que el PDF original.
 *
 * Cada fila queda con la URL del chunk y su número de página dentro de
 * él; /api/boleta extrae esa página cuando alguien pide la boleta.
 *
 *   POST { loteId, chunk: { b64, pages: [nroDePaginaEnElPdfOriginal, ...] } }
 */
const { requireAuth, getIndex, setIndex, getRows, setRows, countPdf } = require('./_lib');

// Sin Blob conectado no hay dónde guardar los PDF. Se devuelve este código
// para que el frontend avise y el lote siga andando en modo link solamente.
const SIN_BLOB = 'blob_no_configurado';

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const { loteId, chunk } = req.body || {};
    if (!loteId || !chunk || !chunk.b64 || !Array.isArray(chunk.pages) || !chunk.pages.length) {
      res.status(400).json({ error: 'Falta loteId o chunk' });
      return;
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      res.status(503).json({
        error: 'No hay un Blob store conectado al proyecto',
        code: SIN_BLOB
      });
      return;
    }

    const rows = await getRows(loteId);
    if (!rows.length) {
      res.status(404).json({ error: 'El lote no existe o no tiene filas' });
      return;
    }

    const { put } = require('@vercel/blob');
    const primera = chunk.pages[0];
    const ultima = chunk.pages[chunk.pages.length - 1];

    const { url } = await put(
      'siro/' + loteId + '/p' + primera + '-' + ultima + '.pdf',
      Buffer.from(chunk.b64, 'base64'),
      { access: 'public', contentType: 'application/pdf', addRandomSuffix: true }
    );

    let stored = 0;
    chunk.pages.forEach((page, i) => {
      const j = rows.findIndex((r) => r.page === page);
      if (j === -1) return;
      // pageInBlob es 1-based, igual que page
      rows[j] = { ...rows[j], blobUrl: url, pageInBlob: i + 1 };
      stored++;
    });

    await setRows(loteId, rows);

    const index = await getIndex();
    const entry = index.find((e) => e.id === loteId);
    if (entry) {
      entry.pdfCount = countPdf(rows);
      await setIndex(index);
    }

    res.status(200).json({ stored, pdfCount: countPdf(rows) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
