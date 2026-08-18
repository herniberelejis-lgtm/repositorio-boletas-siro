/*
 * Prueba de punta a punta: maneja la app real en Chromium contra el
 * servidor local, con un PDF de cupones generado en el momento.
 *
 * Cubre el circuito completo que usa el operador: entrar con la
 * contraseña, cargar un PDF de SIRO, buscar un afiliado y bajar su
 * boleta — verificando que el PDF que vuelve sea la página correcta.
 *
 * El PDF es sintético para no meter datos de afiliados reales en el
 * repositorio, pero replica la estructura de los cupones de SIRO.
 *
 * Se saltea si falta Chromium en la máquina.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { iniciar } = require('./servidor-local.cjs');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const CUENTA = '7009900110';

// Los cupones de prueba. El primero sin nombre, como los que manda SIRO
// con la descripción vacía.
const BOLETAS = [
  { afiliado: 4407, nombre: 'PEREZ ANA MARIA', cents: 21340000, venc: '20/08/2026' },
  { afiliado: 4408, nombre: '', cents: 13670000, venc: '20/08/2026' },
  { afiliado: 55231, nombre: 'GOMEZ CARLOS', cents: 18492000, venc: '20/08/2026' }
];

function datosCupon(b) {
  const ident = String(b.afiliado).padStart(8, '0');
  const [dd, mm, yyyy] = b.venc.split('/');
  return {
    ident,
    cpe: '0' + ident + CUENTA,
    barcode: '0449' + '0' + ident + (yyyy.slice(2) + mm + dd) +
      String(b.cents).padStart(8, '0') + '0'.repeat(20) + CUENTA + '65',
    importe: '$' + (b.cents / 100).toFixed(2).replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d),)/g, '.')
  };
}

/** Dibuja un PDF con una página por cupón, en el orden en que SIRO los pone. */
async function generarPdfCupones() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const b of BOLETAS) {
    const d = datosCupon(b);
    const page = doc.addPage([595, 842]);
    let y = 800;
    const linea = (txt, size = 9) => {
      page.drawText(txt, { x: 40, y, size, font });
      y -= size + 6;
    };
    linea('APROSS', 12);
    linea(b.nombre || ' ');
    linea(d.ident);
    linea('Complemento');
    linea('Descripción');
    linea('Identificador');
    linea(d.barcode, 7);
    linea(d.cpe);
    linea('Código de pago electrónico');
    linea('AGOSTO 2026');
    linea('Concepto');
    linea('Descripción de Concepto');
    linea(d.importe);
    linea(b.venc);
    linea('1er vencimiento');
    linea('Vencimientos');
  }
  return Buffer.from(await doc.save());
}

function chromiumDisponible() {
  try {
    require('playwright').chromium.executablePath();
    return true;
  } catch (e) {
    return false;
  }
}

test('circuito completo: cargar un PDF de cupones, buscar y bajar la boleta',
  { skip: chromiumDisponible() ? false : 'falta Chromium', timeout: 120000 },
  async (t) => {
    const { chromium } = require('playwright');
    const { url, servidor } = await iniciar(0);
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();

    t.after(async () => {
      await navegador.close();
      await new Promise((r) => servidor.close(r));
    });

    // El proxy del entorno puede no dejar salir a cdnjs, así que las
    // librerías del <head> se sirven desde node_modules.
    const locales = {
      'xlsx.full.min.js': require.resolve('xlsx/dist/xlsx.full.min.js'),
      'pdf.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.js'),
      'pdf.worker.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.worker.js'),
      'pdf-lib.min.js': require.resolve('pdf-lib/dist/pdf-lib.min.js')
    };
    await page.route('https://cdnjs.cloudflare.com/**', (route) => {
      const archivo = locales[path.basename(new URL(route.request().url()).pathname)];
      if (!archivo) return route.abort();
      route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: fs.readFileSync(archivo, 'utf8')
      });
    });
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));

    // ---- login -------------------------------------------------------
    await page.goto(url);
    await page.fill('#passwordInput', 'mal');
    await page.click('#loginBtn');
    await assert.doesNotReject(page.waitForSelector('#loginError:has-text("Contraseña incorrecta")'));

    await page.fill('#passwordInput', 'Apross2026');
    await page.click('#loginBtn');
    await page.waitForSelector('#mainApp:not(.hidden)');
    await assert.doesNotReject(page.waitForSelector('#statusBadge:has-text("Repositorio vacío")'));

    // ---- carga del PDF -----------------------------------------------
    const pdfBuf = await generarPdfCupones();
    const pdfPath = path.join(os.tmpdir(), 'Cupones_prueba.pdf');
    fs.writeFileSync(pdfPath, pdfBuf);

    await page.click('#adminToggle');

    // el panel de estado reporta la configuración del proyecto
    await page.waitForSelector('#estadoWrap .review-row');
    const estado = await page.textContent('#estadoWrap');
    assert.match(estado, /Base KV/);
    assert.match(estado, /Almacén Blob/);
    assert.match(estado, /APP_PASSWORD/);

    await page.setInputFiles('#fileInput', pdfPath);

    await page.waitForSelector('#uploadLog .log-line.ok', { timeout: 60000 });
    const log = await page.textContent('#uploadLog .log-line.ok');
    assert.match(log, /3 boletas/, 'se reconocieron las 3 boletas: ' + log);
    assert.match(log, /3 con PDF descargable/, 'se guardaron los 3 PDF: ' + log);
    assert.match(log, /AGOSTO 2026/, 'se detectó el periodo: ' + log);

    // el repositorio refleja la carga y no quedan filas sin afiliado
    const stats = await page.textContent('#repoStats');
    assert.match(stats, /3\s*boletas totales/);
    assert.ok(await page.locator('#reviewPanel').isHidden(),
      'no debería haber nada para revisar');

    // ---- búsqueda ----------------------------------------------------
    await page.click('#adminToggleBack');
    // con ceros a la izquierda, un afiliado que no existe, y un CPE entero
    await page.fill('#queryBox', '0000004407\n999999\n' + datosCupon(BOLETAS[2]).cpe);
    await page.click('#searchBtn');
    await page.waitForSelector('#resultsPanel:not(.hidden) .result-block');

    const bloques = page.locator('.result-block');
    assert.strictEqual(await bloques.count(), 3);

    const primero = bloques.nth(0);
    assert.match(await primero.textContent(), /Afiliado 4407/);
    assert.match(await primero.textContent(), /Encontrado/);
    assert.match(await primero.textContent(), /PEREZ ANA MARIA/);
    assert.match(await primero.textContent(), /\$213\.400,00/);
    assert.match(await primero.textContent(), /20\/08\/2026/);

    assert.match(await bloques.nth(1).textContent(), /No encontrado/,
      'el afiliado inexistente no debe traer boletas');

    const porCpe = bloques.nth(2);
    assert.match(await porCpe.textContent(), /Afiliado 55231/);
    assert.match(await porCpe.textContent(), /buscado por CPE/);
    assert.match(await porCpe.textContent(), /GOMEZ CARLOS/);

    // ---- descarga de la boleta ---------------------------------------
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      porCpe.locator('.pdf-btn.ghost').first().click()
    ]);
    assert.match(descarga.suggestedFilename(), /^boleta-55231-20-08-2026\.pdf$/);

    const bajado = fs.readFileSync(await descarga.path());
    const doc = await PDFDocument.load(bajado);
    assert.strictEqual(doc.getPageCount(), 1, 'la boleta bajada tiene que ser una sola página');

    // y tiene que ser la página del afiliado buscado, no otra
    const texto = await textoDelPdf(bajado);
    assert.match(texto, new RegExp(datosCupon(BOLETAS[2]).cpe));
    assert.match(texto, /GOMEZ CARLOS/);
    assert.doesNotMatch(texto, /PEREZ ANA MARIA/);

    assert.deepStrictEqual(errores, [], 'la página no debe tirar errores de JS');
  });

test('circuito del Excel de Links de Pago: cargar, buscar y quitar el lote',
  { skip: chromiumDisponible() ? false : 'falta Chromium', timeout: 120000 },
  async (t) => {
    const { chromium } = require('playwright');
    const XLSX = require('xlsx');
    const { url, servidor } = await iniciar(0);
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext()).newPage();

    t.after(async () => {
      await navegador.close();
      await new Promise((r) => servidor.close(r));
    });

    const locales = {
      'xlsx.full.min.js': require.resolve('xlsx/dist/xlsx.full.min.js'),
      'pdf.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.js'),
      'pdf.worker.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.worker.js'),
      'pdf-lib.min.js': require.resolve('pdf-lib/dist/pdf-lib.min.js')
    };
    await page.route('https://cdnjs.cloudflare.com/**', (route) => {
      const archivo = locales[path.basename(new URL(route.request().url()).pathname)];
      if (!archivo) return route.abort();
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(archivo, 'utf8') });
    });
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));

    // planilla con el mismo encabezado que exporta SIRO
    const filas = [
      ['LINKS DE PAGO', '', ''],
      ['', '', ''],
      ['Convenio:', 'APROSS', ''],
      ['Cuenta Cte N:', '0000080066/0', ''],
      ['', '', ''],
      ['CPE', '', 'Link de Pago'],
      ['0006043117009900110', '', 'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0006043117009900110/'],
      ['0000044077009900110', '', 'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0000044077009900110/']
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Sheet');
    const xlsxPath = path.join(os.tmpdir(), 'Links_de_Pago_prueba.xlsx');
    XLSX.writeFile(wb, xlsxPath);

    await page.goto(url);
    await page.fill('#passwordInput', 'Apross2026');
    await page.click('#loginBtn');
    await page.waitForSelector('#mainApp:not(.hidden)');

    await page.click('#adminToggle');
    await page.setInputFiles('#fileInput', xlsxPath);
    await page.waitForSelector('#uploadLog .log-line.ok', { timeout: 60000 });

    const log = await page.textContent('#uploadLog .log-line.ok');
    assert.match(log, /2 filas/, log);
    assert.match(log, /sólo links de pago/, log);
    assert.match(await page.textContent('#repoTableWrap'), /Excel SIRO/);

    // el Excel no trae PDF, así que la búsqueda ofrece solamente el link
    await page.click('#adminToggleBack');
    await page.fill('#queryBox', '604311');
    await page.click('#searchBtn');
    await page.waitForSelector('.result-block');

    const bloque = page.locator('.result-block').first();
    assert.match(await bloque.textContent(), /Afiliado 604311/);
    assert.match(await bloque.textContent(), /Encontrado/);
    assert.match(await bloque.textContent(), /sólo link/);
    assert.strictEqual(await bloque.locator('.pdf-btn').count(), 0,
      'sin PDF guardado no debería ofrecer descarga');
    assert.strictEqual(
      await bloque.locator('a').first().getAttribute('href'),
      'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0006043117009900110/');

    // quitar el lote deja el repositorio vacío. Se espera a que la tabla
    // termine de dibujarse: entrar al panel dispara un refresco que
    // reemplaza el botón, y el click se perdería contra el nodo viejo.
    await page.click('#adminToggle');
    await page.waitForSelector('#repoTableWrap table .del-btn');
    await page.click('#repoTableWrap table .del-btn');
    await page.waitForSelector('#statusBadge:has-text("Repositorio vacío")');

    await page.click('#adminToggleBack');
    await page.fill('#queryBox', '604311');
    await page.click('#searchBtn');
    await page.waitForSelector('.result-block .stamp.notfound');

    assert.deepStrictEqual(errores, [], 'la página no debe tirar errores de JS');
  });

test('el repositorio deja quitar en bloque los lotes con PDF a medio guardar',
  { skip: chromiumDisponible() ? false : 'falta Chromium', timeout: 120000 },
  async (t) => {
    const { chromium } = require('playwright');
    const { PDFDocument: PDFDoc } = require('pdf-lib');
    const { url, servidor } = await iniciar(0);
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext()).newPage();

    t.after(async () => {
      await navegador.close();
      await new Promise((r) => servidor.close(r));
    });

    const locales = {
      'xlsx.full.min.js': require.resolve('xlsx/dist/xlsx.full.min.js'),
      'pdf.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.js'),
      'pdf.worker.min.js': require.resolve('pdfjs-dist/legacy/build/pdf.worker.js'),
      'pdf-lib.min.js': require.resolve('pdf-lib/dist/pdf-lib.min.js')
    };
    await page.route('https://cdnjs.cloudflare.com/**', (route) => {
      const archivo = locales[path.basename(new URL(route.request().url()).pathname)];
      if (!archivo) return route.abort();
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: fs.readFileSync(archivo, 'utf8') });
    });
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));

    const AUTH = { 'x-app-password': 'Apross2026', 'Content-Type': 'application/json' };
    const dummyPdfB64 = Buffer.from(await (await PDFDoc.create()).save()).toString('base64');

    // Se siembra el estado directo por API, sin pasar por el drag-and-drop:
    // lo que se está probando es el panel de administración, no la carga.
    const fila = (page) => ({ cpe: '000000000' + page + '7009900110', afiliado: String(page), page });

    const completo = await page.request.post(url + '/api/lotes', {
      headers: AUTH,
      data: JSON.stringify({
        filename: 'lote-completo.pdf', fileType: 'pdf',
        rows: [1, 2].map(fila)
      })
    });
    const { id: idCompleto } = await completo.json();
    await page.request.post(url + '/api/boletas-pdf', {
      headers: AUTH,
      data: JSON.stringify({ loteId: idCompleto, chunk: { b64: dummyPdfB64, pages: [1, 2] } })
    });

    const incompleto = await page.request.post(url + '/api/lotes', {
      headers: AUTH,
      data: JSON.stringify({
        filename: 'lote-incompleto.pdf', fileType: 'pdf',
        rows: [1, 2, 3, 4].map(fila)
      })
    });
    const { id: idIncompleto } = await incompleto.json();
    // sólo se guarda la mitad de las páginas — el resto quedó sin PDF,
    // como pasa si el deploy cambia de versión a mitad de una carga real
    await page.request.post(url + '/api/boletas-pdf', {
      headers: AUTH,
      data: JSON.stringify({ loteId: idIncompleto, chunk: { b64: dummyPdfB64, pages: [1, 2] } })
    });

    await page.goto(url);
    await page.fill('#passwordInput', 'Apross2026');
    await page.click('#loginBtn');
    await page.waitForSelector('#mainApp:not(.hidden)');
    await page.click('#adminToggle');
    await page.waitForSelector('#repoTableWrap table');

    const filaIncompleta = page.locator('#repoTableWrap tr', { hasText: 'lote-incompleto.pdf' });
    await assert.doesNotReject(filaIncompleta.locator('.flag', { hasText: 'incompleto' }).waitFor());
    // columnas: Archivo, Tipo, Periodo, Convenio, Cuenta, Boletas, Con PDF, ...
    const celdaConPdf = (await filaIncompleta.locator('td').nth(6).textContent()).trim();
    assert.strictEqual(celdaConPdf, '2 incompleto', 'debe mostrar 2 con PDF, no 4');

    const filaCompleta = page.locator('#repoTableWrap tr', { hasText: 'lote-completo.pdf' });
    assert.strictEqual(await filaCompleta.locator('.flag').count(), 0,
      'el lote completo no debería llevar la marca de incompleto');

    const btnFallidos = page.locator('#clearFallidosBtn');
    await assert.doesNotReject(btnFallidos.waitFor({ state: 'visible' }));
    assert.match(await btnFallidos.textContent(), /1 lote/);

    page.once('dialog', (d) => d.accept());
    await btnFallidos.click();
    // se espera a que la fila salga del DOM (renderRepo() reconstruye la
    // tabla entera), no a que el botón quede "visible": un elemento que ya
    // estaba oculto nunca cumple esa espera y el test cuelga.
    await filaIncompleta.waitFor({ state: 'detached' });
    assert.ok(await btnFallidos.isHidden(),
      'el botón de lotes con PDF incompleto debería ocultarse cuando ya no queda ninguno');

    const tablaFinal = await page.locator('#repoTableWrap').textContent();
    assert.doesNotMatch(tablaFinal, /lote-incompleto\.pdf/, 'el lote incompleto se tenía que borrar');
    assert.match(tablaFinal, /lote-completo\.pdf/, 'el lote completo no se tenía que tocar');

    assert.deepStrictEqual(errores, [], 'la página no debe tirar errores de JS');
  });

async function textoDelPdf(buf) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const partes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    partes.push(c.items.map((i) => i.str).join('\n'));
  }
  return partes.join('\n');
}
