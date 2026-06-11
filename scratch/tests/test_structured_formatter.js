"use strict";

const path = require("path");
// Cargar dotenv desde el raíz del proyecto
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { runProviderChain } = require("../src/services/gemini");

const systemInstruction = [
  "Actúas como un clasificador de intención y extractor de entidades NLU avanzado para el sector agropecuario argentino.",
  "Tu tarea es analizar el mensaje del usuario (productor) y generar un JSON estricto.",
  "Debes responder ÚNICAMENTE con el objeto JSON, sin formato markdown, sin explicaciones ni texto adicional.",
  "",
  "Schema JSON requerido:",
  "{",
  "  \"intent\": \"saludo|clima|precio|registrar_movimiento|consultar_registros|comando|fuera_dominio|ambiguo\",",
  "  \"parametros\": {",
  "    \"cultivo\": \"soja|maiz|trigo|girasol|cebada|sorgo|papa|null\",",
  "    \"producto\": \"hacienda|insumos|null\",",
  "    \"monto\": number o null,",
  "    \"cantidad\": number o null,",
  "    \"unidad\": \"kg|tn|qq|cabezas|has|bolsas|lts|null\",",
  "    \"concepto\": \"concepto del gasto/compra o null\",",
  "    \"periodo\": \"hoy|manana|pasado_manana|fin_de_semana|semana|todos|null\",",
  "    \"zona\": \"nombre de localidad/provincia si se especifica en el mensaje, o null\",",
  "    \"caravana\": \"código de caravana del animal o null\",",
  "    \"comando\": \"MI RESUMEN|VER COMANDOS|MIS ALERTAS|PLANES|null\"",
  "  },",
  "  \"explicacion_corta\": \"breve justificación técnica interna de tu decisión\"",
  "}",
  "",
  "Reglas de Extracción:",
  "1. Si el usuario saluda, agradece o charla brevemente sin pedir nada → intent='saludo'.",
  "2. Si pregunta clima, pronóstico, heladas o lluvias → intent='clima'. Extrae 'periodo' (mapeado a 'hoy', 'manana', 'pasado_manana', 'fin_de_semana', 'semana', 'todos') y 'zona' si se mencionan.",
  "3. Si pregunta precios, cotizaciones de granos, hacienda, insumos o dólar → intent='precio'. Mapea 'cultivo' o 'producto' ('hacienda', 'insumos') según corresponda.",
  "4. Si provee datos concretos para registrar un gasto, venta o inventario (ej: 'vendí 100 tn de soja', 'gasté 50000 en semilla', 'tengo 120 novillos en lote Norte') → intent='registrar_movimiento'. Extrae 'monto', 'cantidad', 'unidad', 'concepto', 'cultivo' según aplique.",
  "5. Si pregunta por sus propios registros (ej: 'qué tengo en inventario', 'mis gastos de este mes', 'cuanto vendí') → intent='consultar_registros'.",
  "6. Si ejecuta un comando o su equivalente natural (ej: 'mandame mi resumen', 'qué planes hay', 'ver comandos') → intent='comando'. Extrae el comando estándar.",
  "7. Si no pertenece al ámbito del negocio agropecuario o es charla fuera de dominio (ej. deportes, política, geografía general) → intent='fuera_dominio'.",
  "8. Si menciona palabras clave de campo pero sin un verbo de acción claro o datos suficientes (ej. 'soja 100tn', 'lote 2 con pasto') → intent='ambiguo'."
].join("\n");

const testInputs = [
  "hola buenas tardes che",
  "lloverá este fin de semana en Tandil?",
  "¿cuánto cotiza el maíz hoy en Rosario?",
  "Registrá que gasté 450000 pesos en urea",
  "Che, vendí 80 toneladas de trigo",
  "mostrame mis gastos de este mes",
  "pasame mi resumen de alertas",
  "¿quién ganó el partido de Boca de ayer?"
];

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DE EXTRACCIÓN NLU ===\n");
  
  for (const input of testInputs) {
    console.log(`Mensaje del usuario: "${input}"`);
    try {
      const out = await runProviderChain({
        system: systemInstruction,
        user: `Mensaje: ${input}`,
        contextLabel: "Test.NLU",
        opts: {
          temperature: 0,
          responseMimeType: "application/json"
        }
      });
      
      const parsed = JSON.parse(out.texto.trim());
      console.log("Resultado NLU:", JSON.stringify(parsed, null, 2));
    } catch (err) {
      console.error("Error al procesar:", err.message);
    }
    console.log("-------------------------------------------\n");
  }
}

runTests();
