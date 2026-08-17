/*
 * Pruebas del parseo de cupones y del Excel de Links de Pago.
 *
 * Los fixtures son sintéticos a propósito: los cupones reales traen nombre,
 * importe y CPE de afiliados de APROSS, y eso no va a un repositorio git.
 * La estructura sí es la real, tomada de cupones de SIRO:
 *   CPE de 19 dígitos = identificador(9) + cuenta SIRO(10)
 *   código de barras de 59 = empresa(4) + ident(9) + YYMMDD + centavos(8) + …
 */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../siro-parse');

const CUENTA = '7009900110';

/** Arma el texto de una página de cupón como lo entrega pdf.js. */
function cupon({ afiliado, nombre = '', cents, venc, periodo = 'AGOSTO 2026' }) {
  const ident = String(afiliado).padStart(8, '0');
  const cpe = '0' + ident + CUENTA;
  const [dd, mm, yyyy] = venc.split('/');
  const barcode = '0449' + ('0' + ident) + (yyyy.slice(2) + mm + dd) +
    String(cents).padStart(8, '0') + '0'.repeat(20) + CUENTA + '65';
  const importe = '$' + (cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
  return [
    'APROSS', '', nombre, ident, '', 'Complemento', 'Descripción', 'Identificador', '',
    barcode, '', cpe, 'Código de pago electrónico', '',
    'Sin', 'código', 'de', 'barras', periodo, '', 'Concepto', 'Descripción de Concepto',
    '', importe, '', venc, '3er vencimiento', '2do vencimiento', '1er vencimiento', 'Vencimientos'
  ].join('\n');
}

test('el afiliado sale del CPE quitando la cuenta SIRO', () => {
  assert.deepStrictEqual(S.afiliadoFromCpe('0000044077009900110'), {
    afiliado: '4407', cuentaSiro: CUENTA, cpe: '0000044077009900110'
  });
  assert.strictEqual(S.afiliadoFromCpe('0003718527009900110').afiliado, '371852');
  assert.strictEqual(S.afiliadoFromCpe('0076543217009900110').afiliado, '7654321');
});

test('un CPE de largo inesperado no devuelve un afiliado inventado', () => {
  assert.strictEqual(S.afiliadoFromCpe('123'), null);
  assert.strictEqual(S.afiliadoFromCpe(''), null);
  assert.strictEqual(S.afiliadoFromCpe('00000000000000000000000'), null);
});

test('con la cuenta conocida se resuelven CPE de otro largo', () => {
  assert.strictEqual(S.afiliadoFromCpe('44077009900110', CUENTA).afiliado, '4407');
});

test('normalizeAfiliado ignora ceros a la izquierda y separadores', () => {
  for (const v of ['3910284', '0003910284', '3.910.284', ' 3910284 ']) {
    assert.strictEqual(S.normalizeAfiliado(v), '3910284');
  }
  assert.strictEqual(S.normalizeAfiliado('0'), '');
  assert.strictEqual(S.normalizeAfiliado('abc'), '');
});

test('la cuenta SIRO se deduce del lote', () => {
  assert.strictEqual(S.inferCuentaSiro(['0000044077009900110', '0000552317009900110']), CUENTA);
  assert.strictEqual(S.inferCuentaSiro([]), null);
});

test('el código de barras da importe y vencimiento', () => {
  const bc = S.parseBarcode('04490000552312608201849200000000000000000000000700990011065');
  assert.strictEqual(bc.identificador, '000055231');
  assert.strictEqual(bc.vencimiento, '20/08/2026');
  assert.strictEqual(bc.importe, '$184.920,00');
  assert.strictEqual(bc.importeCents, 18492000);
});

test('un cupón completo se parsea entero', () => {
  const r = S.parseCuponText(cupon({
    afiliado: 4407, nombre: 'GARCIA MARIA ELENA', cents: 21340000, venc: '20/08/2026'
  }));
  assert.strictEqual(r.afiliado, '4407');
  assert.strictEqual(r.nombre, 'GARCIA MARIA ELENA');
  assert.strictEqual(r.importe, '$213.400,00');
  assert.strictEqual(r.vencimiento, '20/08/2026');
  assert.strictEqual(r.periodo, 'AGOSTO 2026');
  assert.strictEqual(r.cpe, '0000044077009900110');
  assert.strictEqual(r.link, 'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0000044077009900110/');
  assert.strictEqual(r.revisar, '');
});

test('SIRO deja la descripción vacía en muchos cupones y eso no es un error', () => {
  const r = S.parseCuponText(cupon({ afiliado: 62190, cents: 13670000, venc: '20/08/2026' }));
  assert.strictEqual(r.nombre, '');
  assert.strictEqual(r.afiliado, '62190');
});

test('el código de barras de 59 dígitos no se confunde con el CPE de 19', () => {
  const r = S.parseCuponText(cupon({ afiliado: 55231, cents: 18492000, venc: '20/08/2026' }));
  assert.strictEqual(r.cpe.length, 19);
  assert.strictEqual(r.afiliado, '55231');
});

test('si el identificador impreso no coincide con el CPE, la fila queda marcada', () => {
  const texto = cupon({ afiliado: 4407, cents: 100, venc: '20/08/2026' })
    .replace('\n00004407\n', '\n00009999\n');
  const r = S.parseCuponText(texto);
  assert.strictEqual(r.afiliado, '4407');
  assert.match(r.revisar, /identificador impreso 00009999/);
});

test('una página que no es un cupón se descarta', () => {
  assert.strictEqual(S.parseCuponText('Hoja de portada sin ningún código'), null);
  assert.strictEqual(S.parseCuponText(''), null);
});

test('parseCupones numera las páginas y reporta las omitidas', () => {
  const r = S.parseCupones([
    cupon({ afiliado: 4407, cents: 100, venc: '20/08/2026' }),
    'una página suelta sin cupón',
    cupon({ afiliado: 55231, cents: 200, venc: '20/08/2026' })
  ]);
  assert.strictEqual(r.rows.length, 2);
  assert.deepStrictEqual(r.rows.map(x => x.page), [1, 3]);
  assert.deepStrictEqual(r.paginasOmitidas, [2]);
  assert.strictEqual(r.convenio, 'APROSS');
  assert.strictEqual(r.cuenta, CUENTA);
  assert.strictEqual(r.periodo, 'AGOSTO 2026');
});

// Este es el caso que rompía la heurística anterior de prefijo/sufijo común:
// con afiliados de dígitos iniciales parecidos se comía dígitos significativos
// y devolvía 7, 8 y 50 en lugar de 4407, 4408 y 4450.
test('un lote chico con afiliados parecidos no pierde dígitos', () => {
  const r = S.parseCupones([4407, 4408, 4450].map(
    a => cupon({ afiliado: a, cents: 100, venc: '20/08/2026' })
  ));
  assert.deepStrictEqual(r.rows.map(x => x.afiliado), ['4407', '4408', '4450']);
});

test('un lote de un solo cupón también resuelve el afiliado', () => {
  const r = S.parseCupones([cupon({ afiliado: 55231, cents: 18492000, venc: '20/08/2026' })]);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].afiliado, '55231');
});

test('el Excel de Links de Pago se parsea con encabezado y todo', () => {
  const filas = [
    ['LINKS DE PAGO', '', ''],
    ['', '', ''],
    ['Convenio:', 'APROSS', ''],
    ['Cuenta Cte N:', '0000990011/0', ''],
    ['', '', ''],
    ['CPE', '', 'Link de Pago'],
    ['0006043117009900110', '', 'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0006043117009900110/'],
    ['0000044077009900110', '', '']
  ];
  const r = S.parseLinksDePago(filas);
  assert.strictEqual(r.convenio, 'APROSS');
  assert.strictEqual(r.cuenta, '0000990011/0');
  assert.strictEqual(r.cuentaSiro, CUENTA);
  assert.deepStrictEqual(r.rows.map(x => x.afiliado), ['604311', '4407']);
  // el link que ya venía se respeta
  assert.match(r.rows[0].link, /0006043117009900110\/$/);
  // y el que faltaba se reconstruye desde el CPE
  assert.strictEqual(r.rows[1].link,
    'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/0000044077009900110/');
});

test('una planilla sin columna CPE se rechaza en vez de inventar filas', () => {
  const r = S.parseLinksDePago([['otra cosa'], ['sin', 'encabezado']]);
  assert.strictEqual(r.rows, null);
});

test('el importe se formatea como en el cupón', () => {
  assert.strictEqual(S.formatImporteFromCents(18492000), '$184.920,00');
  assert.strictEqual(S.formatImporteFromCents(100), '$1,00');
  assert.strictEqual(S.formatImporteFromCents(5), '$0,05');
});
