/*
 * Revisa archivos de SIRO sin cargarlos al repositorio.
 *
 *   node scripts/verificar.cjs Cupones_*.pdf Links_de_Pago.xlsx
 *   node scripts/verificar.cjs --detalle Cupones_xxx.pdf
 *
 * Sirve para chequear una exportación nueva antes de subirla: dice cuántas
 * boletas reconoce, si pudo sacar el afiliado de todas y si el
 * identificador impreso coincide con el que sale del CPE.
 *
 * Usa el mismo siro-parse.js que el navegador, así que lo que diga acá es
 * lo que va a pasar en la app.
 *
 * Necesita las dependencias de desarrollo: npm install
 */
const fs = require('fs');
const path = require('path');
const S = require('../siro-parse');

const args = process.argv.slice(2);
const detalle = args.includes('--detalle');
const archivos = args.filter((a) => !a.startsWith('--'));

if (!archivos.length) {
  console.error('Uso: node scripts/verificar.cjs [--detalle] <archivos .pdf o .xlsx>');
  process.exit(1);
}

async function textoDePaginas(file) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const paginas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    paginas.push(c.items.map((i) => i.str).join('\n'));
  }
  return paginas;
}

function resumir(nombre, rows, extra) {
  const sinAfiliado = rows.filter((r) => !r.afiliado);
  const aRevisar = rows.filter((r) => r.revisar);
  const conNombre = rows.filter((r) => r.nombre).length;
  const afiliados = new Set(rows.map((r) => r.afiliado).filter(Boolean));

  console.log('\n' + nombre);
  console.log('  ' + rows.length + ' boletas · ' + afiliados.size + ' afiliados distintos' +
    (extra ? ' · ' + extra : ''));
  // el Excel de Links de Pago no trae nombres, sólo el CPE
  const esPdf = rows.some((r) => r.page != null);
  if (esPdf) {
    console.log('  con nombre: ' + conNombre + '/' + rows.length +
      '  (SIRO deja la descripción vacía en muchos cupones)');
  }

  if (sinAfiliado.length) {
    console.log('  ⚠ ' + sinAfiliado.length + ' sin afiliado:');
    sinAfiliado.slice(0, 10).forEach((r) => console.log('      CPE ' + r.cpe + ' — ' + r.revisar));
  } else {
    console.log('  ✓ todas las boletas tienen afiliado');
  }

  if (aRevisar.length) {
    console.log('  ⚠ ' + aRevisar.length + ' con discrepancias:');
    aRevisar.slice(0, 10).forEach((r) =>
      console.log('      pág ' + r.page + ' afiliado ' + r.afiliado + ' — ' + r.revisar));
  } else if (rows.some((r) => r.identificador)) {
    console.log('  ✓ el identificador impreso coincide con el derivado del CPE en todas');
  }

  const repetidos = [...afiliados].filter(
    (a) => rows.filter((r) => r.afiliado === a).length > 1);
  if (repetidos.length) {
    console.log('  · ' + repetidos.length + ' afiliados con más de una boleta en este archivo');
  }

  if (detalle) {
    console.log('  ' + '-'.repeat(70));
    rows.forEach((r) => console.log('  ' +
      String(r.page == null ? '' : 'p' + r.page).padEnd(6) +
      String(r.afiliado).padEnd(10) +
      String(r.importe || '').padEnd(14) +
      String(r.vencimiento || '').padEnd(12) +
      (r.nombre || '')));
  }
  return { rows, afiliados };
}

(async () => {
  const todos = [];

  for (const file of archivos) {
    if (!fs.existsSync(file)) {
      console.log('\n' + file + '\n  ⚠ no existe');
      continue;
    }
    const nombre = path.basename(file);
    try {
      if (/\.pdf$/i.test(file)) {
        const parsed = S.parseCupones(await textoDePaginas(file));
        const extra = [
          parsed.convenio && 'convenio ' + parsed.convenio,
          parsed.cuenta && 'cuenta SIRO ' + parsed.cuenta,
          parsed.periodo,
          parsed.paginasOmitidas.length
            ? parsed.paginasOmitidas.length + ' páginas sin cupón'
            : null
        ].filter(Boolean).join(' · ');
        todos.push(resumir(nombre, parsed.rows, extra));
      } else {
        const XLSX = require('xlsx');
        const wb = XLSX.read(fs.readFileSync(file));
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
          { header: 1, defval: '', raw: false });
        const parsed = S.parseLinksDePago(filas);
        if (parsed.rows === null) {
          console.log('\n' + nombre + '\n  ⚠ no tiene el formato esperado (falta la columna CPE)');
          continue;
        }
        const extra = [
          parsed.convenio && 'convenio ' + parsed.convenio,
          parsed.cuenta && 'cuenta ' + parsed.cuenta
        ].filter(Boolean).join(' · ');
        todos.push(resumir(nombre, parsed.rows, extra));
      }
    } catch (err) {
      console.log('\n' + nombre + '\n  ⚠ error al leerlo: ' + err.message);
    }
  }

  if (todos.length > 1) {
    const union = new Set();
    let boletas = 0;
    todos.forEach((t) => {
      boletas += t.rows.length;
      t.afiliados.forEach((a) => union.add(a));
    });
    console.log('\n' + '='.repeat(72));
    console.log('En total: ' + boletas + ' boletas de ' + union.size + ' afiliados distintos');
  }
})();
