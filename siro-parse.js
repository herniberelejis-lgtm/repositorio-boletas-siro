/*
 * Parseo de boletas SIRO (Banco Roela) para el convenio APROSS.
 *
 * El mismo archivo se usa desde el navegador (index.html lo carga como
 * <script>) y desde Node (los tests lo requieren), de ahí el wrapper.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiroParse = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Estructura del CPE
  // ---------------------------------------------------------------------
  // El CPE ("código de pago electrónico") de SIRO tiene 19 dígitos: los
  // primeros 9 son el identificador del cliente dentro del convenio — el
  // número de afiliado de APROSS con ceros a la izquierda — y los últimos
  // 10 identifican la cuenta SIRO del convenio.
  //
  //     0 0 0 0 0 4 4 0 7 | 7 0 0 9 9 0 0 1 1 0
  //     └───── 9 ────────┘ └──────── 10 ───────┘
  //      afiliado 4407          cuenta SIRO
  //
  // Verificado contra 61 cupones y las 1040 filas del Excel de Links de
  // Pago: el identificador impreso en el cupón coincide siempre con este
  // cálculo. Por eso el afiliado se deriva del CPE en lugar de adivinarse
  // comparando prefijos comunes del lote, que es incorrecto en lotes
  // chicos: con afiliados 4407/4408/4450 el prefijo común se come
  // dígitos significativos y devuelve 7/8/50.
  var CPE_LEN = 19;
  var CUENTA_LEN = 10;
  var ID_LEN = CPE_LEN - CUENTA_LEN; // 9

  // ---------------------------------------------------------------------
  // Estructura del código de barras del cupón (59 dígitos)
  // ---------------------------------------------------------------------
  // Repite los datos del pago en posiciones fijas. Es la fuente más
  // confiable de importe y vencimiento porque no depende del orden en que
  // el PDF exponga el texto:
  //
  //   0449 000055231 260820 18492000 …ceros… 7009900110 65
  //   └──┘ └───────┘ └────┘ └──────┘         └────────┘ └┘
  //   empr  ident.   YYMMDD  centavos          cuenta   dv
  //
  // Los ceros del medio son los espacios del 2º y 3er vencimiento. No
  // pude confirmar su layout porque ningún cupón de muestra los usa, así
  // que sólo se decodifican los campos verificados.
  var BC_LEN = 59;
  var BC_ID = [4, 13];
  var BC_FECHA = [13, 19];
  var BC_IMPORTE = [19, 27];

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function digits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  /**
   * Normaliza un número de afiliado a su forma canónica (sin ceros a la
   * izquierda) para poder comparar lo que escribe el usuario con lo que
   * viene en el CPE. "0003910284", "3.910.284" y "3910284" son el mismo.
   */
  function normalizeAfiliado(v) {
    var d = digits(v);
    if (!d) return '';
    var n = parseInt(d, 10);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  }

  /**
   * Deriva el afiliado y la cuenta SIRO de un CPE.
   *
   * @param cpe         el CPE, con o sin separadores
   * @param cuentaHint  cuenta SIRO conocida del lote; permite resolver
   *                    CPEs de largo no estándar
   * @returns {{afiliado, cuentaSiro, cpe}} o null si no se pudo
   */
  function afiliadoFromCpe(cpe, cuentaHint) {
    var s = digits(cpe);
    if (!s) return null;

    var cuenta = null;
    if (cuentaHint && s.length > cuentaHint.length && s.slice(-cuentaHint.length) === cuentaHint) {
      cuenta = cuentaHint;
    } else if (s.length === CPE_LEN) {
      cuenta = s.slice(ID_LEN);
    }
    if (!cuenta) return null;

    var afiliado = normalizeAfiliado(s.slice(0, s.length - cuenta.length));
    if (!afiliado) return null;
    return { afiliado: afiliado, cuentaSiro: cuenta, cpe: s };
  }

  /**
   * Deduce la cuenta SIRO de un lote. Con CPEs de 19 dígitos es directo;
   * si vinieran con otro largo cae al sufijo común más largo, que en un
   * lote real converge a la cuenta.
   */
  function inferCuentaSiro(cpes) {
    var list = (cpes || []).map(digits).filter(Boolean);
    if (!list.length) return null;

    var counts = {};
    var best = null;
    list.forEach(function (c) {
      if (c.length !== CPE_LEN) return;
      var suf = c.slice(ID_LEN);
      counts[suf] = (counts[suf] || 0) + 1;
      if (!best || counts[suf] > counts[best]) best = suf;
    });
    if (best) return best;

    // sufijo común más largo
    var shortest = list.reduce(function (a, b) { return b.length < a.length ? b : a; });
    var len = 0;
    while (len < shortest.length) {
      var ch = shortest[shortest.length - 1 - len];
      if (!list.every(function (c) { return c[c.length - 1 - len] === ch; })) break;
      len++;
    }
    return len >= 6 ? shortest.slice(shortest.length - len) : null;
  }

  function linkDePago(cpe) {
    return 'https://siropagos.bancoroela.com.ar/Home/PagoOffLine/' + digits(cpe) + '/';
  }

  function formatImporteFromCents(cents) {
    if (!Number.isFinite(cents)) return '';
    var neg = cents < 0;
    var s = String(Math.abs(cents)).padStart(3, '0');
    var ent = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-$' : '$') + ent + ',' + s.slice(-2);
  }

  function importeToCents(txt) {
    var m = String(txt == null ? '' : txt).match(/(\d[\d.]*),(\d{2})/);
    if (!m) return null;
    return parseInt(m[1].replace(/\./g, ''), 10) * 100 + parseInt(m[2], 10);
  }

  /** "260820" -> "20/08/2026" */
  function fechaFromBarcode(yymmdd) {
    if (!/^\d{6}$/.test(yymmdd)) return '';
    var yy = yymmdd.slice(0, 2), mm = yymmdd.slice(2, 4), dd = yymmdd.slice(4, 6);
    var mn = parseInt(mm, 10), dn = parseInt(dd, 10);
    if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return '';
    return dd + '/' + mm + '/20' + yy;
  }

  /** Decodifica los campos verificados del código de barras. */
  function parseBarcode(bc) {
    var s = digits(bc);
    if (s.length !== BC_LEN) return null;
    var cents = parseInt(s.slice(BC_IMPORTE[0], BC_IMPORTE[1]), 10);
    return {
      identificador: s.slice(BC_ID[0], BC_ID[1]),
      vencimiento: fechaFromBarcode(s.slice(BC_FECHA[0], BC_FECHA[1])),
      importe: formatImporteFromCents(cents),
      importeCents: Number.isFinite(cents) ? cents : null
    };
  }

  /**
   * Extrae el nombre del titular, que en el cupón va entre el nombre del
   * convenio y el identificador. SIRO lo deja vacío para muchos clientes
   * (30 de 61 en las muestras), así que la ausencia es normal.
   */
  function nombreFromCupon(text, ancla) {
    var i = text.indexOf('APROSS');
    if (i === -1 || !ancla) return '';
    var after = text.slice(i + 'APROSS'.length);
    var j = after.indexOf(ancla);
    if (j <= 0) return '';
    var nombre = after.slice(0, j).replace(/\s+/g, ' ').trim();
    // descartar etiquetas del formulario y cualquier cosa con dígitos
    if (!nombre || nombre.length > 80 || /\d/.test(nombre)) return '';
    if (/Complemento|Descripci|Identificador|Código/i.test(nombre)) return '';
    return nombre;
  }

  function periodoFromCupon(text) {
    var re = new RegExp('\\b(' + MESES.join('|') + ')\\s+(\\d{4})\\b', 'i');
    var m = text.match(re);
    return m ? m[1].toUpperCase() + ' ' + m[2] : '';
  }

  /**
   * Parsea una página de cupón ya convertida a texto.
   *
   * El CPE se busca como una corrida aislada de 19 dígitos: el código de
   * barras tiene 59, así que los lookarounds evitan confundirlos.
   *
   * @returns una fila, o null si la página no es un cupón
   */
  function parseCuponText(text, opts) {
    var t = String(text == null ? '' : text);
    var o = opts || {};

    var cpeMatch = t.match(/(?<!\d)(\d{19})(?!\d)/);
    if (!cpeMatch) return null;
    var cpe = cpeMatch[1];

    var bcMatch = t.match(/(?<!\d)(\d{40,70})(?!\d)/);
    var bc = bcMatch ? parseBarcode(bcMatch[1]) : null;

    var derivado = afiliadoFromCpe(cpe, o.cuentaSiro);
    if (!derivado) return null;

    // El identificador también viene impreso como texto. Se usa como
    // control cruzado del valor derivado del CPE, no como fuente: si
    // alguna vez difieren, la fila queda marcada para revisar.
    var idMatch = t.match(/(?<!\d)(\d{8})(?!\d)/);
    var idImpreso = idMatch ? idMatch[1] : '';
    var idBarcode = bc ? bc.identificador : '';

    var discrepancias = [];
    if (idImpreso && normalizeAfiliado(idImpreso) !== derivado.afiliado) {
      discrepancias.push('identificador impreso ' + idImpreso);
    }
    if (idBarcode && normalizeAfiliado(idBarcode) !== derivado.afiliado) {
      discrepancias.push('identificador del código de barras ' + idBarcode);
    }

    // Importe y vencimiento: el código de barras manda. El texto se usa
    // sólo si no hay código de barras legible, porque los tres slots de
    // vencimiento aparecen en orden inverso al visual y no se puede saber
    // cuál es cuál a partir del orden.
    var importesTxt = (t.match(/\$\s?\d[\d.]*,\d{2}/g) || []).map(function (s) {
      return s.replace(/\s/g, '');
    });
    var vencsTxt = t.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];

    var importe = bc && bc.importe ? bc.importe : (importesTxt[0] || '');
    var vencimiento = bc && bc.vencimiento ? bc.vencimiento : (vencsTxt[0] || '');

    return {
      cpe: cpe,
      afiliado: derivado.afiliado,
      cuentaSiro: derivado.cuentaSiro,
      identificador: idImpreso || idBarcode || '',
      nombre: nombreFromCupon(t, idImpreso || cpe),
      importe: importe,
      importeCents: bc ? bc.importeCents : importeToCents(importesTxt[0]),
      vencimiento: vencimiento,
      // vencimientos adicionales que aparecen en el texto y no puedo
      // atribuir a un slot concreto; se muestran como dato, sin etiqueta
      vencimientosExtra: vencsTxt.filter(function (v) { return v !== vencimiento; }),
      periodo: periodoFromCupon(t),
      link: linkDePago(cpe),
      revisar: discrepancias.length ? discrepancias.join('; ') : ''
    };
  }

  /**
   * Parsea las páginas de texto de un PDF de cupones.
   *
   * Se hacen dos pasadas: la primera junta los CPEs para deducir la cuenta
   * SIRO del lote, la segunda parsea cada página sabiéndola.
   */
  function parseCupones(pageTexts) {
    var textos = pageTexts || [];
    var cpesCrudos = textos.map(function (t) {
      var m = String(t == null ? '' : t).match(/(?<!\d)(\d{19})(?!\d)/);
      return m ? m[1] : null;
    }).filter(Boolean);

    var cuentaSiro = inferCuentaSiro(cpesCrudos);

    var rows = [];
    var omitidas = [];
    textos.forEach(function (t, i) {
      var row = parseCuponText(t, { cuentaSiro: cuentaSiro });
      if (row) {
        row.page = i + 1; // 1-based, como lo numera el visor de PDF
        rows.push(row);
      } else {
        omitidas.push(i + 1);
      }
    });

    var convenio = textos.some(function (t) { return String(t).indexOf('APROSS') !== -1; }) ? 'APROSS' : '';
    var periodo = (rows.find(function (r) { return r.periodo; }) || {}).periodo || '';

    return {
      rows: rows,
      convenio: convenio,
      cuenta: cuentaSiro || '',
      periodo: periodo,
      paginasOmitidas: omitidas
    };
  }

  /**
   * Parsea el Excel "Links de Pago" de SIRO, que trae el convenio y la
   * cuenta en el encabezado y después una fila por CPE.
   *
   * @param sheetRows  matriz de filas (XLSX.utils.sheet_to_json header:1)
   */
  function parseLinksDePago(sheetRows) {
    var rows = sheetRows || [];
    var convenio = '', cuenta = '', headerIdx = -1;

    for (var i = 0; i < rows.length; i++) {
      var c0 = String((rows[i] || [])[0] == null ? '' : rows[i][0]).trim().toLowerCase();
      if (c0 === 'convenio:') convenio = String(rows[i][1] == null ? '' : rows[i][1]).trim();
      if (c0.indexOf('cuenta cte') === 0) cuenta = String(rows[i][1] == null ? '' : rows[i][1]).trim();
      if (c0 === 'cpe') { headerIdx = i; break; }
    }
    if (headerIdx === -1) return { rows: null, convenio: convenio, cuenta: cuenta };

    var crudas = [];
    for (var j = headerIdx + 1; j < rows.length; j++) {
      var r = rows[j] || [];
      var cpe = digits(r[0]);
      if (!cpe) continue;
      // el link está en la 3ª columna; la 2ª viene vacía en el formato de SIRO
      var link = String(r[2] == null ? '' : r[2]).trim();
      crudas.push({ cpe: cpe, link: link });
    }

    var cuentaSiro = inferCuentaSiro(crudas.map(function (d) { return d.cpe; }));

    var out = crudas.map(function (d) {
      var der = afiliadoFromCpe(d.cpe, cuentaSiro);
      return {
        cpe: d.cpe,
        afiliado: der ? der.afiliado : null,
        cuentaSiro: der ? der.cuentaSiro : '',
        identificador: '',
        nombre: '',
        importe: '',
        importeCents: null,
        vencimiento: '',
        vencimientosExtra: [],
        periodo: '',
        // el Excel ya trae el link armado, pero viene truncado en algunas
        // exportaciones de SIRO, así que se prefiere reconstruirlo del CPE
        link: /PagoOffLine\/\d{19}/.test(d.link) ? d.link : linkDePago(d.cpe),
        revisar: der ? '' : 'no se pudo derivar el afiliado del CPE',
        page: null
      };
    });

    return { rows: out, convenio: convenio, cuenta: cuenta, cuentaSiro: cuentaSiro || '' };
  }

  return {
    CPE_LEN: CPE_LEN,
    CUENTA_LEN: CUENTA_LEN,
    ID_LEN: ID_LEN,
    normalizeAfiliado: normalizeAfiliado,
    afiliadoFromCpe: afiliadoFromCpe,
    inferCuentaSiro: inferCuentaSiro,
    parseBarcode: parseBarcode,
    parseCuponText: parseCuponText,
    parseCupones: parseCupones,
    parseLinksDePago: parseLinksDePago,
    linkDePago: linkDePago,
    formatImporteFromCents: formatImporteFromCents
  };
});
