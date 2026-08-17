# Repositorio de Boletas SIRO (APROSS)

Buscador de boletas de pago SIRO (Banco Roela) por número de afiliado.
Se cargan los archivos que exporta SIRO —los PDF de cupones y el Excel de
Links de Pago— y después se busca un afiliado y salen sus boletas, con el
PDF descargable y el link de pago.

## Cómo se saca el número de afiliado

Esta es la parte que hace que funcione, así que conviene tenerla clara.

El CPE (*código de pago electrónico*) de SIRO tiene 19 dígitos, y está
formado por dos bloques fijos:

```
0 0 0 0 0 4 4 0 7 | 7 0 0 9 9 0 0 1 1 0
└───── 9 ────────┘ └──────── 10 ───────┘
 identificador          cuenta SIRO
 = afiliado 4407        del convenio (ejemplo)
```

El identificador es el número de afiliado de APROSS con ceros a la
izquierda. Así que el afiliado se **calcula**, no se adivina: se le quitan
los 10 dígitos de la cuenta y se sacan los ceros sobrantes.

Verificado sobre los archivos reales: **61 cupones y 1040 filas del Excel,
todas resueltas, y en los 61 cupones el identificador impreso coincide con
el derivado del CPE.** Cuando el cupón trae el identificador impreso, se
usa como control cruzado: si alguna vez no coincidiera, la fila queda
marcada para revisar en lugar de guardar un dato dudoso.

El cupón trae además un código de barras de 59 dígitos con los mismos
datos en posiciones fijas, y de ahí salen el importe y el vencimiento:

```
0449 000055231 260820 18492000 …ceros… 7009900110 65
└──┘ └───────┘ └────┘ └──────┘         └────────┘ └┘
empr  ident.   YYMMDD  centavos          cuenta   dv
```

Se prefiere el código de barras al texto porque los tres vencimientos del
cupón aparecen en el texto en orden inverso al visual, y por el orden no
se puede saber cuál es cuál.

## Qué hay que tener en cuenta

- **Un afiliado puede tener varias boletas.** En las muestras, 12 de 49
  afiliados tenían más de una (mismo período, distinto vencimiento). La
  búsqueda las devuelve todas, la más nueva primero.
- **SIRO deja el nombre vacío en muchos cupones** (30 de 61 lo traían). No
  es un error de lectura: el campo viene en blanco. Para identificar al
  titular quedan el afiliado, el importe y el vencimiento.
- **El Excel de Links de Pago no tiene los PDF**, sólo los CPE y los
  links. Los lotes cargados desde Excel se buscan igual, pero ofrecen sólo
  el link de pago.
- **Si se vuelve a cargar un archivo con el mismo nombre, reemplaza al
  anterior** y borra sus PDF, para no duplicar.

## Puesta en marcha en Vercel

1. **Vercel KV** (Storage → Create Database → KV → Connect to Project).
   Ahí se guardan los lotes y las filas.
2. **Vercel Blob** (Storage → Create → Blob → Connect to Project). Ahí van
   los PDF. Sin Blob la app sigue funcionando, pero avisa en la carga y
   deja sólo los links de pago.
3. **`APP_PASSWORD`** en Settings → Environment Variables. Es la
   contraseña de acceso. Si no se define queda la que estaba hardcodeada
   (`Apross2026`), así que conviene configurarla y redeployar.

Para confirmar que las tres cosas quedaron conectadas, entrar en **Modo
administrador**: el panel *Configuración del proyecto* dice cuál falta. Lo
mismo responde `GET /api/estado` (pide la contraseña, no devuelve secretos).

### Cuánto ocupa

Cada boleta pesa unos **55 KB** en Blob. Mil boletas por mes son ~55 MB
por mes, que se acumulan hasta que se borren los lotes viejos.

Las páginas se guardan agrupadas de a 25 en un mismo PDF justamente por
esto: comparten las fuentes embebidas. De a una, la misma boleta ocupaba
183 KB — 3,4 veces más.

## Diseño

La paleta sale del logo (`logo.png`): el verde `#00AB99` y el rojo `#FF2800`
son los del archivo. El problema es que ese verde sobre blanco da **2,88:1**
de contraste, así que no sirve ni como texto ni como fondo de un botón con
texto blanco — no llega al 4,5:1 de WCAG AA. Por eso hay tres tokens:

| Token | Color | Contraste | Para qué |
| --- | --- | --- | --- |
| `--brand` | `#00AB99` | — | identidad: logo, bordes, barras, acentos. Nunca texto. |
| `--brand-ink` | `#00786B` | 5,4:1 | el verde cuando tiene que ser texto |
| `--brand-fill` | `#008073` | 4,8:1 | fondo de botón con texto blanco, anillo de foco |
| `--ink` | `#111418` | 18,5:1 | texto principal, negro neutro |
| `--ink-soft` | `#5A6169` | 6,3:1 | texto secundario |
| `--danger-ink` | `#C41E00` | 5,9:1 | texto de error |

Los grises no tienen tinte verde a propósito: así el texto se lee sobrio y
el verde funciona como acento en lugar de teñir toda la pantalla. Los 15
pares de color que usa la interfaz pasan WCAG AA.

Tipografía **Fira Sans** para la interfaz y **Fira Code** para datos (CPE,
importes, tablas), que es donde alinear dígitos importa.

El logo venía con fondo blanco opaco, que se veía como un recuadro sobre
cualquier fondo que no fuera blanco. Está desmatado a transparencia: al
recomponerlo sobre blanco da un resultado idéntico al original, píxel por
píxel.

Otras decisiones que vienen del checklist de accesibilidad: anillo de foco
visible para navegación con teclado, `prefers-reduced-motion` respetado,
"Encontrado / No encontrado" se distingue por la palabra y no sólo por el
color, la marca de revisión es texto en lugar de un emoji, y las tablas
scrollean dentro de su contenedor para que la página nunca scrollee en
horizontal.

## Desarrollo

```
npm install
npm test                # 19 pruebas: parseo + dos circuitos end-to-end en Chromium
npm run dev:fake        # la app entera en http://127.0.0.1:3000, sin Vercel
```

`npm run dev:fake` levanta los endpoints reales de `api/` con KV y Blob
reemplazados por equivalentes en memoria, así se puede probar todo el
circuito sin cuenta de Vercel. Los datos se pierden al cortar el proceso.

Para revisar una exportación nueva de SIRO sin cargarla:

```
node scripts/verificar.cjs Cupones_*.pdf Links_de_Pago.xlsx
node scripts/verificar.cjs --detalle Cupones_xxx.pdf
```

Dice cuántas boletas reconoce, si le pudo sacar el afiliado a todas y si
el identificador impreso coincide con el del CPE.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `siro-parse.js` | Parseo de cupones y del Excel. Lo usan el navegador, los endpoints y los tests. |
| `index.html` | Frontend: búsqueda, modo administrador y carga. |
| `api/lotes.js` | Listar, crear y vaciar lotes. |
| `api/lote/[id].js` | Quitar un lote, listar sus filas a revisar, corregir un afiliado a mano. |
| `api/boletas-pdf.js` | Guarda las páginas del PDF en Blob por tandas. |
| `api/boleta.js` | Devuelve el PDF de una boleta, extrayendo su página del blob. |
| `api/search.js` | Búsqueda por afiliado (o por CPE completo) contra todos los lotes. |
| `api/estado.js` | Diagnóstico: qué está conectado (KV, Blob, `APP_PASSWORD`). |
| `api/_lib.js` | KV, autenticación y proyecciones compartidas. |
| `test/` | Pruebas de parseo y end-to-end, más el servidor local. |
| `scripts/verificar.cjs` | Revisa archivos de SIRO desde la línea de comandos. |

Las URL de Vercel Blob son públicas, así que nunca se le mandan al
navegador: los PDF salen por `/api/boleta`, que pide la contraseña igual
que el resto de los endpoints.

## Límites conocidos

- La contraseña es una sola y compartida, sin usuarios ni registro de
  quién consultó qué. Alcanza para una herramienta interna; si en algún
  momento hace falta trazabilidad, hay que cambiarlo.
- La búsqueda lee las filas de todos los lotes en cada consulta. Con este
  volumen (1101 boletas) va bien; si crece mucho conviene un índice
  afiliado → boletas en KV.
- Del código de barras se decodifican sólo los campos verificados
  (identificador, 1er vencimiento e importe). Si un cupón trae 2º y 3er
  vencimiento, los importes y fechas extra se muestran como dato sin
  atribuirlos a un vencimiento, porque ninguna muestra los usaba y no se
  pudo confirmar en qué posición van.
