const { kv } = require('@vercel/kv');

const INDEX_KEY = 'siro-lotes-index';
const APP_PASSWORD = 'Apross2026';

module.exports = async (req, res) => {
  if (req.headers['x-app-password'] !== APP_PASSWORD) {
    res.status(401).json({ error: 'Contraseña incorrecta' });
    return;
  }
  try {
    const { id } = req.query;
    if (req.method === 'DELETE') {
      let index = (await kv.get(INDEX_KEY)) || [];
      index = index.filter(e => e.id !== id);
      await kv.set(INDEX_KEY, index);
      await kv.del('siro-lote:' + id);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
