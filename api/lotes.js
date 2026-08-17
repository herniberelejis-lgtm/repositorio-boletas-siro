const { kv } = require('@vercel/kv');

const INDEX_KEY = 'siro-lotes-index';
const APP_PASSWORD = 'Apross2026';

module.exports = async (req, res) => {
  if (req.headers['x-app-password'] !== APP_PASSWORD) {
    res.status(401).json({ error: 'Contraseña incorrecta' });
    return;
  }
  try {
    if (req.method === 'GET') {
      const index = (await kv.get(INDEX_KEY)) || [];
      res.status(200).json({ index });
      return;
    }

    if (req.method === 'POST') {
      const { filename, convenio, cuenta, fileType, rows } = req.body || {};
      if (!filename || !Array.isArray(rows)) {
        res.status(400).json({ error: 'Falta filename o rows' });
        return;
      }

      const id = 'lote_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const failedCount = rows.filter(r => !r.afiliado).length;

      await kv.set('siro-lote:' + id, rows);

      let index = (await kv.get(INDEX_KEY)) || [];
      // reemplaza si ya existía un lote con el mismo nombre de archivo
      const prior = index.find(e => e.filename === filename);
      if (prior) {
        await kv.del('siro-lote:' + prior.id);
        index = index.filter(e => e.filename !== filename);
      }
      index.push({
        id, filename, convenio: convenio || '', cuenta: cuenta || '', fileType: fileType || 'excel',
        rowCount: rows.length, failedCount,
        uploadedAt: new Date().toISOString()
      });
      await kv.set(INDEX_KEY, index);

      res.status(200).json({ id, rowCount: rows.length, failedCount });
      return;
    }

    if (req.method === 'DELETE') {
      // vaciar todo el repositorio
      const index = (await kv.get(INDEX_KEY)) || [];
      for (const e of index) {
        await kv.del('siro-lote:' + e.id);
      }
      await kv.set(INDEX_KEY, []);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
