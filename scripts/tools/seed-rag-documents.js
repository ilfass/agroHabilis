"use strict";

require("dotenv").config();
const { query, pool } = require("../../src/config/database");
const { generarEmbedding } = require("../../src/services/agent/ia/embeddings");

const DOCUMENTOS = [
  // SANIDAD ANIMAL
  {
    titulo: "Plan de Vacunación Obligatoria en Argentina (Campaña Aftosa y Brucelosis)",
    fuente: "manual_sanidad",
    contenido: "El Plan de Vacunación Obligatoria del Senasa exige la vacunación sistemática contra la Fiebre Aftosa de todas las categorías bovinas y bubalinas en las dos campañas anuales. La primera campaña del año (otoño) suele abarcar a todas las categorías menores (terneros/as, novillitos, novillos, vaquillonas). La segunda campaña (primavera) abarca la totalidad del rodeo (incluyendo vacas y toros). La vacunación contra Brucelosis bovina es obligatoria para terneras de 3 a 8 meses de edad con vacuna cepa 19, y se realiza una vez en la vida del animal."
  },
  {
    titulo: "Prevención de Carbunclo Bacteridiano y Clostridiosis en Rodeos de Cría",
    fuente: "manual_sanidad",
    contenido: "El Carbunclo bacteridiano (ántrax) es una zoonosis de curso agudo y alta mortalidad. En la provincia de Buenos Aires, la vacunación contra Carbunclo es obligatoria una vez al año para todos los animales mayores de 8 meses. Por su parte, las enfermedades clostridiales (Mancha, Gangrena Gaseosa y Enterotoxemia) se previenen vacunando a los terneros a los 3 meses de edad con una primera dosis, repitiendo la dosis a los 21 días (refuerzo) para lograr inmunidad sólida antes del destete."
  },
  {
    titulo: "Tratamiento de Parásitos Gastrointestinales y Sarna en Bovinos",
    fuente: "manual_sanidad",
    contenido: "El control de parásitos gastrointestinales en terneros de destete debe realizarse bajo diagnóstico coprológico (HPG). Las drogas más utilizadas son las Ivermectinas al 1%, 3.15% o Ricobendazole (bencimidazoles). El período de carencia (retiro) de la Ivermectina 1% para consumo humano es de 35 días, mientras que para Ivermectina al 3.15% (larga acción) se extiende a 120 días. En el caso de sarna bovina, el tratamiento obligatorio aprobado por Senasa incluye dos aplicaciones de ivermectina inyectable con 7 días de intervalo o baños de inmersión autorizados."
  },
  
  // AGROQUIMICOS SENASA
  {
    titulo: "Guía de Aplicación de Glifosato y Control de Malezas Difíciles",
    fuente: "agroquimicos_senasa",
    contenido: "El Glifosato es un herbicida sistémico no selectivo usado para el control de malezas en barbecho químico y cultivos tolerantes (Soja RR, Maíz RR). La dosis estándar varía entre 2 y 4 litros por hectárea de formulación al 48% (sal isopropilamina). Malezas resistentes como Yuyo Colorado (Amaranthus hybridus) y Rama Negra (Conyza bonariensis) requieren mezclas con herbicidas hormonales (como 2,4-D o Dicamba) o pre-emergentes (como sulfentrazone o metolaclor). El tiempo de carencia para el ingreso seguro a lotes tratados es de 24 horas."
  },
  {
    titulo: "Manejo Seguro de Aplicaciones de Atrazina en Maíz y Sorgo",
    fuente: "agroquimicos_senasa",
    contenido: "La Atrazina es un herbicida de amplio espectro, principalmente pre-emergente, utilizado en maíz y sorgo. Se absorbe por raíces y hojas. Las dosis recomendadas oscilan entre 1.5 y 3 kg/ha según la textura del suelo y contenido de materia orgánica. Senasa restringe su aplicación en zonas con napas freáticas superficiales debido a su alta persistencia y lixiviabilidad. El período de carencia mínimo entre la última aplicación de Atrazina y la cosecha de forraje o grano de maíz es de 45 días."
  },
  {
    titulo: "Regulaciones de Deriva y Condiciones Ambientales para Pulverización",
    fuente: "agroquimicos_senasa",
    contenido: "Para evitar la deriva exógena de fitosanitarios, Senasa y las normativas provinciales prohiben pulverizar con velocidades de viento superiores a 15 km/h o inferiores a 4 km/h (viento calmo genera inversión térmica y deriva por suspensión). La humedad relativa óptima debe ser superior al 50% y la temperatura inferior a 30°C. Es obligatorio respetar las distancias de amortiguamiento (buffers) de 100 metros para aplicaciones terrestres y 500 metros para aéreas respecto a zonas urbanas o cursos de agua permanente."
  },

  // CALENDARIO DE SIEMBRA INTA
  {
    titulo: "Calendario de Siembra de Trigo y Cebada en la Zona Núcleo",
    fuente: "calendario_inta",
    contenido: "En la Zona Núcleo argentina (norte de Buenos Aires, sur de Santa Fe, sudeste de Córdoba), la ventana óptima de siembra de trigo para ciclos largos se extiende desde fines de mayo hasta mediados de junio. Los ciclos cortos se siembran desde mediados de junio hasta fines de julio. La temperatura del suelo a nivel de siembra debe estar preferentemente entre 10°C y 15°C para una germinación uniforme. La cebada cervecera comparte ventanas similares, concentrando su siembra a lo largo de todo el mes de junio."
  },
  {
    titulo: "Ventana de Siembra de Maíz Temprano y Tardío en Región Pampeana",
    fuente: "calendario_inta",
    contenido: "La siembra de maíz temprano en la Región Pampeana se realiza desde mediados de septiembre hasta mediados de octubre, buscando que la floración (período crítico) ocurra a fines de diciembre con buena radiación y antes del estrés hídrico de enero. El maíz tardío (o de segunda) se siembra desde fines de noviembre hasta mediados de diciembre; esta estrategia ubica la floración en febrero con menores temperaturas y menor evaporación, asegurando rindes estables en años secos o bajo fenómeno La Niña."
  },
  {
    titulo: "Épocas Óptimas de Siembra de Soja de Primera y Segunda",
    fuente: "calendario_inta",
    contenido: "La soja de primera tiene su ventana óptima de siembra en la zona pampeana entre el 20 de octubre y el 15 de noviembre, logrando el máximo potencial de rendimiento al maximizar la intercepción de radiación solar durante el llenado de granos (R3-R5). La soja de segunda (sembrada inmediatamente después de la cosecha de trigo o cebada) se siembra durante todo el mes de diciembre; cada día de retraso en la siembra de segunda después del 10 de diciembre representa una pérdida promedio de rendimiento de 30 kg/ha por día."
  }
];

async function run() {
  console.log("==> Iniciando semillado de documentos RAG con pgvector...");
  
  try {
    // 1. Limpiar tabla
    await query("DELETE FROM rag_documentos");
    console.log("Tabla rag_documentos limpiada.");

    // 2. Insertar cada documento con su embedding
    let insertados = 0;
    for (const doc of DOCUMENTOS) {
      console.log(`Vectorizando: "${doc.titulo}" (${doc.fuente})...`);
      const embedding = await generarEmbedding(doc.contenido);
      const vectorStr = `[${embedding.join(",")}]`;

      await query(
        `
          INSERT INTO rag_documentos (titulo, fuente, contenido, embedding)
          VALUES ($1, $2, $3, $4::vector)
        `,
        [doc.titulo, doc.fuente, doc.contenido, vectorStr]
      );
      insertados++;
    }

    console.log(`✅ Éxito: Se sembraron ${insertados} documentos con embeddings en la tabla rag_documentos.`);
  } catch (error) {
    console.error("❌ Error durante el semillado RAG:", error.message);
  } finally {
    await pool.end();
  }
}

run();
