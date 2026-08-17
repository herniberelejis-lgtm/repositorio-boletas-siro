/*
 * Búsqueda de boletas por número de afiliado contra todos los lotes.
 *
 *   POST { queries: ["3910284", "371852", ...] }
 *
 * Acepta el número con o sin ceros a la izquierda y con separadores, y
 * también un CPE completo de 19 dígitos (se convierte al afiliado).
 */
const { requireAuth, getIndex, getRows, publicRow } = require('./_lib');
const SiroParse = require('../siro-parse');

/** "20/08/2026" -> 20260820, para poder ordenar. Sin fecha va último. */
function vencOrden(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || '');
  return m ? Number(m[3] + m[2] + m[1]) : 0;
}

/**
 * Interpreta lo que escribió el usuario. Un CPE de 19 dígitos se traduce al
 * afiliado que tiene adentro; cualquier otra cosa se toma como el número de
 * afiliado y se normaliza.
 */
function interpretarQuery(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === SiroParse.CPE_LEN) {
    const der = SiroParse.afiliadoFromCpe(d);
    if (der) return { afiliado: der.afiliado, ingresado: raw, comoCpe: true };
  }
  const af = SiroParse.normalizeAfiliado(d);
  return af ? { afiliado: af, ingresado: raw, comoCpe: false } : null;
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  try {
    const { queries } = req.body || {};
    if (!Array.isArray(queries) || !queries.length) {
      res.status(400).json({ error: 'Falta queries' });
      return;
    }

    // se deduplican por afiliado ya normalizado
    const vistos = new Set();
    const consultas = [];
    for (const q of queries) {
      const parsed = interpretarQuery(q);
      if (!parsed || vistos.has(parsed.afiliado)) continue;
      vistos.add(parsed.afiliado);
      consultas.push(parsed);
    }
    if (!consultas.length) {
      res.status(400).json({ error: 'Ninguna de las búsquedas es un número válido' });
      return;
    }

    const index = await getIndex();

    // en paralelo: con varios lotes, hacerlo secuencial multiplica la latencia
    const porLote = await Promise.all(
      index.map(async (entry) => ({ entry, rows: await getRows(entry.id) }))
    );

    // un índice afiliado -> filas evita recorrer todas las filas por consulta
    const porAfiliado = new Map();
    for (const { entry, rows } of porLote) {
      for (const row of rows) {
        if (!row.afiliado) continue;
        const dato = {
          ...publicRow(row),
          loteId: entry.id,
          filename: entry.filename,
          fileType: entry.fileType,
          convenio: entry.convenio || row.convenio || '',
          cuenta: entry.cuenta || '',
          periodo: row.periodo || entry.periodo || '',
          uploadedAt: entry.uploadedAt
        };
        if (!porAfiliado.has(row.afiliado)) porAfiliado.set(row.afiliado, []);
        porAfiliado.get(row.afiliado).push(dato);
      }
    }

    const results = consultas.map((c) => {
      const matches = (porAfiliado.get(c.afiliado) || []).slice();
      // la boleta más nueva primero: es la que se suele estar buscando
      matches.sort((a, b) =>
        vencOrden(b.vencimiento) - vencOrden(a.vencimiento) ||
        String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
      );
      return {
        query: c.afiliado,
        ingresado: c.ingresado,
        comoCpe: c.comoCpe,
        matches
      };
    });

    res.status(200).json({
      results,
      totalLotes: index.length,
      totalBoletas: [...porAfiliado.values()].reduce((s, l) => s + l.length, 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
