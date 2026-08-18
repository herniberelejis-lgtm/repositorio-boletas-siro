/*
 * Devuelve el PDF de una boleta.
 *
 *   GET /api/boleta?lote=<id>&page=<n>
 *
 * El store del proyecto es privado, así que las URL de Blob no se pueden
 * leer con un fetch() común — ni siquiera nosotros, sin autenticar. Se lee
 * con get() de @vercel/blob, que sabe armar la autenticación (token o
 * OIDC, lo que haya). Tampoco se le manda nunca la URL al navegador: el
 * PDF pasa por acá, que exige la contraseña igual que el resto de los
 * endpoints.
 */
const { requireAuth, getRows } = require('./_lib');

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const loteId = req.query.lote;
    const page = Number(req.query.page);
    if (!loteId || !Number.isInteger(page)) {
      res.status(400).json({ error: 'Faltan los parámetros lote y page' });
      return;
    }

    const rows = await getRows(loteId);
    const row = rows.find((r) => r.page === page);
    if (!row) {
      res.status(404).json({ error: 'No existe esa boleta en el lote' });
      return;
    }
    if (!row.blobUrl || !row.blobPathname) {
      res.status(404).json({
        error: 'Esta boleta no tiene el PDF guardado — usá el link de pago'
      });
      return;
    }

    const { get } = require('@vercel/blob');
    const leido = await get(row.blobPathname, { access: 'private' });
    if (!leido || leido.statusCode !== 200) {
      res.status(502).json({ error: 'No se pudo leer el PDF guardado' });
      return;
    }
    const bytesPdf = Buffer.from(await new Response(leido.stream).arrayBuffer());

    // El blob trae varias boletas juntas (ver api/boletas-pdf.js), así que
    // se extrae la página de esta. Las filas guardadas por versiones
    // anteriores tenían un PDF por boleta: ahí pageInBlob es 1 y da igual.
    const { PDFDocument } = require('pdf-lib');
    const origen = await PDFDocument.load(bytesPdf, { ignoreEncryption: true });

    const indice = (row.pageInBlob || 1) - 1;
    if (indice < 0 || indice >= origen.getPageCount()) {
      res.status(500).json({ error: 'El PDF guardado no tiene la página de esta boleta' });
      return;
    }

    const salida = await PDFDocument.create();
    const [pagina] = await salida.copyPages(origen, [indice]);
    salida.addPage(pagina);
    const pdf = Buffer.from(await salida.save());

    const nombreArchivo = 'boleta-' + (row.afiliado || 'sin-afiliado') +
      (row.vencimiento ? '-' + row.vencimiento.replace(/\//g, '-') : '') + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + nombreArchivo + '"');
    // los cupones no cambian, pero son datos personales: sólo caché privada
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
