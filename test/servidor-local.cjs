/*
 * Servidor local para probar la app entera sin Vercel.
 *
 *   npm run dev:fake   ->  http://127.0.0.1:3000
 *
 * Sirve los archivos estáticos y enruta /api/* a los handlers reales de
 * api/, con ioredis y @vercel/blob reemplazados por equivalentes en
 * memoria. La idea es que se pruebe el código que después corre en
 * producción, no una copia.
 *
 * Todo se pierde al cortar el proceso: es para desarrollo y para los tests.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const RAIZ = path.join(__dirname, '..');

// api/_lib.js exige que REDIS_URL exista antes de construir el cliente,
// aunque acá el cliente esté falseado y el valor no se use de verdad.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://fake-local';

// ---- Redis en memoria --------------------------------------------------
// Guarda strings crudos, como el Redis real: la (de)serialización a JSON
// la hace api/_lib.js, no este mock.
const store = new Map();
class FakeRedis {
  constructor() {}
  on() {}
  async get(k) { return store.has(k) ? store.get(k) : null; }
  async set(k, v) { store.set(k, String(v)); return 'OK'; }
  async del(...ks) {
    let n = 0;
    ks.flat().forEach((k) => { if (store.delete(k)) n++; });
    return n;
  }
}

// ---- Blob en memoria -------------------------------------------------
// El store real del proyecto quedó privado (es lo que ofrece Vercel por
// defecto), así que este mock rechaza 'public' con el mismo mensaje que
// tira Vercel — así un test agarra en el momento si algún código vuelve a
// pedir acceso público por error.
//
// Los endpoints miran BLOB_READ_WRITE_TOKEN para saber si hay un store
// conectado; acá hay uno (en memoria), así que se declara.
process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'fake-local';

function exigirAccesoPrivado(opts) {
  if (!opts || opts.access !== 'private') {
    throw new Error(
      "Vercel Blob: Cannot use " + ((opts && opts.access) || 'public') +
      ' access on a private store. The store is configured with private access.'
    );
  }
}

const blobs = new Map();
const fakeBlob = {
  async put(pathname, body, opts) {
    exigirAccesoPrivado(opts);
    const suffix = (opts && opts.addRandomSuffix) ? '-' + Math.random().toString(36).slice(2, 8) : '';
    const key = pathname.replace(/(\.[^./]+)?$/, suffix + '$1');
    blobs.set(key, Buffer.from(body));
    return { url: 'https://fake-blob.local/' + key, pathname: key };
  },
  async get(pathname, opts) {
    exigirAccesoPrivado(opts);
    const buf = blobs.get(pathname);
    if (!buf) return null;
    return { statusCode: 200, blob: { contentType: 'application/pdf' }, stream: new Response(buf).body };
  },
  async del(urlsOrPathnames) {
    for (const u of [].concat(urlsOrPathnames)) {
      const key = u.startsWith('https://fake-blob.local/') ? u.slice('https://fake-blob.local/'.length) : u;
      blobs.delete(key);
    }
  }
};

// Se interceptan los require antes de cargar los handlers.
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'ioredis') return FakeRedis;
  if (request === '@vercel/blob') return fakeBlob;
  return loadOriginal.call(this, request, ...rest);
};

const handlers = {
  '/api/lotes': require('../api/lotes.js'),
  '/api/search': require('../api/search.js'),
  '/api/boleta': require('../api/boleta.js'),
  '/api/boletas-pdf': require('../api/boletas-pdf.js'),
  '/api/estado': require('../api/estado.js')
};
const handlerLote = require('../api/lote/[id].js');

// ---- adaptador req/res al shape que esperan las funciones de Vercel ---
function adaptarRes(res) {
  let code = 200;
  return Object.assign(res, {
    status(c) { code = c; return this; },
    json(obj) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    },
    send(buf) {
      res.writeHead(code);
      res.end(buf);
    }
  });
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 8 * 1024 * 1024) reject(new Error('body demasiado grande'));
      partes.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(partes).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf'
};

async function manejar(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const ruta = url.pathname;

  try {
    if (ruta.startsWith('/api/')) {
      req.query = Object.fromEntries(url.searchParams);
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        req.body = await leerBody(req);
      } else if (req.method === 'DELETE') {
        req.body = await leerBody(req).catch(() => undefined);
      }
      adaptarRes(res);

      const directo = handlers[ruta];
      if (directo) return directo(req, res);

      const m = /^\/api\/lote\/([^/]+)$/.exec(ruta);
      if (m) {
        req.query.id = decodeURIComponent(m[1]);
        return handlerLote(req, res);
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'ruta no encontrada' }));
    }

    // estáticos
    const rel = ruta === '/' ? 'index.html' : ruta.replace(/^\/+/, '');
    const archivo = path.join(RAIZ, rel);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404); return res.end('no encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream' });
    res.end(fs.readFileSync(archivo));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Levanta una instancia limpia. Cada llamada arranca con el repositorio
 * vacío y con su propio servidor, así los tests no se contaminan entre sí.
 */
function iniciar(port = 0) {
  store.clear();
  blobs.clear();
  const servidor = http.createServer(manejar);
  return new Promise((resolve) => {
    servidor.listen(port, '127.0.0.1', () => {
      baseUrl = 'http://127.0.0.1:' + servidor.address().port;
      resolve({ url: baseUrl, servidor, store, blobs });
    });
  });
}

if (require.main === module) {
  iniciar(Number(process.env.PORT) || 3000).then(({ url }) => {
    console.log('Repositorio de boletas SIRO (datos en memoria) en ' + url);
    console.log('Contraseña: ' + (process.env.APP_PASSWORD || 'Apross2026'));
  });
}

module.exports = { iniciar };
