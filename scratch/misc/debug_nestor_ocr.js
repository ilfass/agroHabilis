"use strict";

const { particionarPorLotes, detectarCargaMultiLote } = require("../src/services/inventario/nl_heuristica");

const text = `[Análisis de archivo: ¡Buenas! Ahí te tomé todos los datos de la planificación de siembra para la campaña *26/27*. Te armé un resumen limpio por campo, sumando los lotes y las hectáreas, junto con la receta de siembra abajo.

Acá tenés el detalle de la carga:

*Detalle por Campo y Lote (Cebada Montoya - 1ra):*

*1. Campo: La Manga (Total: 206 Ha)*
• Lote 3: *63 Ha*
• Lote 8 a fina: *45 Ha*
• Lote 11: *45 Ha*
• Lote 13 fina: *13 Ha*
• Lote 14 fina: *10 Ha*
• Lote 15 fina: *30 Ha*

*2. Campo: Don Federico (Total: 230 Ha)*
• Lote 1: *125 Ha*
• Lote 2: *105 Ha*

*3. Campo: Ciervo Blanco (Total: 201 Ha)*
• Lote 7 loma: *42 Ha*
• Lote 11L: *45 Ha*
• Lote 1L: *46 Ha*
• Lote 8: *68 Ha*

*4. Campo: La Celina (Total: 70 Ha)*
• Lote 4 Loma: *38 Ha*
• Lote 5 Loma: *32 Ha*

---
*TOTAL SUPERFICIE CEBADA:* *707 Ha*
---

*Parámetros de Siembra y Fertilización:*
• *Cultivo:* Cebada (Variedad: Montoya)
• *Densidad:* *125 kg/ha* (73 semillas por metro lineal a 21 cm entre surcos).
• *Fertilización:* *40 kg/ha de Microstar*.
• *Nota:* La planificación incluye un *10% de superposición*.

Si necesitás que pasemos estos datos a algún formato específico (como Excel/CSV) o que calculemos el total de semilla y fertilizante necesario para la campaña, avisame y lo hacemos en un toque.] Cargar esos datos`;

console.log("=== RUNNING DETECT ON NESTOR OCR TEXT ===");
const res = detectarCargaMultiLote(text);
if (res) {
  console.log(`Detected multi-lote with ${res.bloques.length} blocks:`);
  res.bloques.forEach((b, i) => {
    console.log(`\nBlock ${i + 1}: Lote ${b.lote_nombre}`);
    console.log(`Fragment: [${b.fragmento}]`);
  });
} else {
  console.log("NO multi-lote detected by heuristics.");
}
