const { kv } = require('@vercel/kv');

const INDEX_KEY = 'siro-lotes-index';
const APP_PASSWORD = 'Apross2026';

function normalizeAfiliado(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return String(parseInt(digits, 10));
}

module.exports = async (req, res) => {
  if (req.headers['x-app-password'] !== APP_PASSWORD) {
    res.status(401).json({ error: 'Contraseña incorrecta' });
    return;
  }
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Método no permitido' });
      return;
    }
    const { queries } = req.body || {};
    if (!Array.isArray(queries) || !queries.length) {
      res.status(400).json({ error: 'Falta queries' });
      return;
    }
    const normQueries = [...new Set(queries.map(normalizeAfiliado))].filter(Boolean);

    const index = (await kv.get(INDEX_KEY)) || [];
    const allRows = [];
    for (const entry of index) {
      const rows = (await kv.get('siro-lote:' + entry.id)) || [];
      rows.forEach(r => allRows.push({
        ...r,
        filename: entry.filename,
        convenio: entry.convenio,
        cuenta: entry.cuenta,
        fileType: entry.fileType
      }));
    }

    const results = normQueries.map(q => ({
      query: q,
      matches: allRows.filter(r => r.afiliado === q)
    }));

    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
