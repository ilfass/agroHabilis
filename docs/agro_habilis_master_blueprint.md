# 🌾 AGROHABILIS — MASTER BLUEPRINT
## Manual de Alcance y Arquitectura Técnica (Dossier Corporativo)

---

> **CONFIDENCIALIDAD Y PROPIEDAD INTELECTUAL**  
> El presente documento contiene información técnica y comercial confidencial propiedad de **AgroHabilis**. Su divulgación, copia o distribución a terceros sin el consentimiento expreso de los directores del proyecto queda terminantemente prohibida.
> 
> *Fecha de Publicación: 22 de Mayo de 2026*  
> *Versión: 2.4.0-PRO*  
> *Estado: Aprobado para Presentación de Socios*

---

## 🗺️ TABLA DE CONTENIDOS
1. [PORTADA E INTRODUCCIÓN COMERCIAL](#1-portada-e-introducción-comercial)
2. [ARQUITECTURA TÉCNICA Y MONITOREO ("El Fierrerío" del Backend)](#2-arquitectura-técnica-y-monitoreo-el-fierrerío-del-backend)
3. [MÓDULOS FUNCIONALES Y CASOS DE USO (9 Módulos Core en Lote)](#3-módulos-funcionales-y-casos-de-uso-9-módulos-core-en-lote)
4. [MODELO DE NEGOCIO Y MONETIZACIÓN](#4-modelo-de-negocio-y-monetización)
5. [ROADMAP Y ESCALABILIDAD (Hacia dónde vamos)](#5-roadmap-y-escalabilidad-hacia-dónde-vamos)

---

## 1. PORTADA E INTRODUCCIÓN COMERCIAL

### Título del Proyecto: *AgroHabilis — El Cerebro del Lote* 🧠🌾

AgroHabilis es una plataforma de inteligencia artificial diseñada específicamente para el sector agropecuario. A diferencia de los complejos sistemas de gestión tradicionales que requieren capacitaciones prolongadas y la carga manual de planillas frías en computadoras de escritorio, AgroHabilis actúa como un **consultor agropecuario premium y ubicuo que reside en el WhatsApp del productor**. 

Opera 100% mediante procesamiento de lenguaje natural (tanto en texto como en **audios de voz** y **fotos de cámaras de campo**) y cuenta con un **portal web interactivo en tiempo real** donde los usuarios con suscripción de pago pueden visualizar de forma analítica sus lotes, movimientos sanitarios, balances de stock y márgenes consolidados.

```
========================================================================
             ESQUEMA 1: EL CICLO DE VIDA DEL DATO EN EL CAMPO
========================================================================
 [1. Entrada]       ──►  [2. Procesamiento] ──►  [3. Persistencia] ──►  [4. Visualización]
 Productor envía         AI Engine parsea         PostgreSQL guarda     Web y WhatsApp
 audios/fotos/texto      intención y SENASA       y asocia usuario      muestran márgenes
========================================================================
```

### Filosofía de Diseño: *Tool-First*, Inmediatez y Calidez Campera
* **Inmediatez Extrema ("Regla del Tractor"):** El productor toma decisiones rápidas arriba del tractor, al lado de la tolva o metido en la manga con el ganado. No tiene tiempo para abrir una aplicación pesada, iniciar sesión, lidiar con la baja señal celular o navegar por menús complejos. AgroHabilis le resuelve el problema en **2 segundos** con un simple mensaje de WhatsApp enviado con un solo pulgar.
* **El Paradigma *Tool-First*:** Cuando un mensaje ingresa, la arquitectura prioriza la activación directa de herramientas de backend (ejecución de queries locales, cotizaciones de mercados, cálculos de dosis de fertilizantes). Si la consulta contiene datos que pueden estructurarse inmediatamente para actuar en el inventario o la base, se ejecuta la acción sin rodeos intelectuales, ahorrando latencia y consumo de API.
* **Calidez Campera:** AgroHabilis no es un bot frío ni corporativo. Saluda con cercanía, conoce la provincia y localidad del usuario (ej. *"Tandil, Buenos Aires"*), comprende los modismos del campo argentino (*"che", "lote", "caravana", "manga", "rinde"*) y responde con una estructura limpia, clara y visualmente descansada (usando negritas y listas en lugar de párrafos densos).

---

## 2. ARQUITECTURA TÉCNICA Y MONITOREO ("El Fierrerío" del Backend)

### Tech Stack y Componentes del Sistema
* **Entorno de Ejecución:** **Node.js (v20+)** en configuración asíncrona no bloqueante.
* **Motor de Base de Datos:** **PostgreSQL (v16)** para almacenamiento estructurado con indexación de alto rendimiento en tablas críticas.
* **Emulación y Conectividad WhatsApp:** **whatsapp-web.js** operando sobre un navegador headless **Puppeteer** aislado.
* **Monitoreo de Procesos:** Servidor administrado en vivo mediante **PM2** con reinicio automático.

### Modelos de IA e Inteligencia Híbrida (Hybrid Intelligence)
La inteligencia de AgroHabilis es orquestada de manera híbrida según el tipo de solicitud:

```
========================================================================
           ESQUEMA 2: ARQUITECTURA HÍBRIDA DE TOMA DE DECISIÓN
========================================================================
  [⚡ Groq Llama 3.1 8B]     ──►  Latencia < 400ms. Clasifica la intención
                                  conversacional y parsea cantidades en base.
                                  
  [🧠 Gemini 1.5 Pro/Flash]  ──►  Razonamiento profundo. Diagnóstico de fotos,
                                  dietas de mixer y redacción final campera.
                                  
  [🔍 Google Search Ground]  ──►  Búsqueda web en vivo. Trae cotizaciones del
                                  disponible del grano y noticias del día.
========================================================================
```

---

## 3. MÓDULOS FUNCIONALES Y CASOS DE USO (9 Módulos Core en Lote)

Se detallan a continuación los **9 módulos funcionales core** que componen la propuesta de valor definitiva de AgroHabilis, con simulaciones de diálogos reales.

### 1️⃣ 🎤 Notas de Audio Activas
* **Descripción:** Mandá un audio mientras recorrés el lote o manejás el tractor. Nuestro Agente procesará tus novedades y registrará tratamientos, clima o siembras en tiempo real sin obligarte a escribir.
* **Interacción Simulada:**
  > 🧑🌾 **Productor (Audio de 0:12):** *«Hola bot, anotame que empezamos a sembrar el lote 3 de trigo a 140 kilos por hectárea...»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 🎙️ *Audio procesado con éxito:*  
  > 📍 *Lote:* Lote 3  
  > 🌱 *Labor:* Siembra  
  > 🌾 *Cultivo:* Trigo  
  > ⚖️ *Densidad:* 140 kg/ha  
  >   
  > ¿Confirmás el registro de este inicio de siembra en el historial?  
  >   
  > 🧑🌾 **Productor:** *«SI»*  
  >   
  > 🤖 **AgroHabilis:** ✅ *Listo, labor registrada en el historial del Lote 3.*  
  > _Siembra Trigo: 140 kg/ha | 📅 22/05/2026_

---

### 2️⃣ 📸 Análisis de Fotos en Vivo (Visión Artificial)
* **Descripción:** Sacale una foto a una maleza desconocida, a un animal con síntomas o a una caravana. AgroHabilis la analizará con inteligencia artificial de visión computacional para darte diagnósticos en segundos.
* **Interacción Simulada:**
  > 🧑🌾 **Productor (Foto adjunta):** *«Qué tiene este cultivo de trigo en el lote 2?»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 👁️‍🗨️ *Análisis de Foto en Vivo:*  
  > Identifico con un **87% de probabilidad** síntomas de **Mancha Amarilla del Trigo (Drechslera tritici-repentis)** en el tercio medio foliar.  
  >   
  > ⚠️ *Recomendación:*  
  > 1. Monitorear nivel de incidencia: si supera el 20-30% de hojas activas, evaluar aplicación.  
  > 2. Fungicidas recomendados: Mezclas de Estrobirulinas + Triazoles para frenar la infección.  
  >   
  > ¿Querés registrar esta alerta en la bitácora fitosanitaria del Lote 2?

---

### 3️⃣ 🩺 Clínica y Carencia Sanitaria
* **Descripción:** Llevá la trazabilidad sanitaria individual por caravana. Registrá vacunas, síntomas y fármacos aplicados. **AgroHabilis calcula y te alerta automáticamente sobre el Período de Carencia (SENASA) de drogas aplicadas antes de la faena o venta.**
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«tengo 1 ternero caravana AR-105 de raza Aberdeen Angus tratado con antibiotico por neumonia en el lote Bajo Grande»*  
  >   
  > 🤖 **AgroHabilis:**  
  > ✅ *Observación registrada para la caravana **AR-105**:*  
  > > “Tratado con antibiótico por neumonía”  
  >   
  > 🛡️ **Período de Carencia (SENASA):**  
  > • **Caravana AR-105:** ⚠️ **Retiro/Carencia activo hasta 20/06/2026** (30 días de carencia obligatoria según normativas de SENASA para terapia antimicrobiana estándar).  
  > ❌ _Prohibida su venta a faena o salida de establecimiento hasta cumplir el plazo de seguridad._  
  >   
  > ¿Confirmás el guardado sanitario en el historial de tu establecimiento?

---

### 4️⃣ 🌱 Monitoreo de Lotes y Siembras
* **Descripción:** Registrá variedades, fechas de siembra, fertilización y expectativas de rinde de cada lote. AgroHabilis guardará todo el historial fenológico del cultivo y mantendrá el inventario actualizado.
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«registra aplicacion de 120 kg/ha de urea en el Lote Norte para el trigo»*  
  >   
  > 🤖 **AgroHabilis:**  
  > ✅ *Aplicación de Fertilizante detectada:*  
  > ━━━━━━━━━━━━━━━━━━━━  
  > 📍 *Lote:* Lote Norte  
  > 🌱 *Labor:* Fertilización  
  > 🧪 *Insumo:* Urea  
  > ⚖️ *Dosis:* 120 kg/ha  
  >   
  > ¿Confirmás el registro de este insumo en el historial?

---

### 5️⃣ 🔄 Rotación de Pasturas
* **Descripción:** Monitoreá pasturas y lotes con semáforos inteligentes (🟢 Óptimo, 🟡 Rebrote, 🔴 Ocupado). Evitá el sobrepastoreo calculando días de descanso y carga animal óptima para el establecimiento.
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«cómo viene la rotación del lote Bajo Grande?»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 🔄 **Monitoreo de Pasturas - Lote: Bajo Grande**  
  > ━━━━━━━━━━━━━━━━━━━━  
  > 📊 *Estado actual:* 🔴 **Ocupado (Sobrepastoreo leve)**  
  > • *Días de ocupación:* 9 días (límite recomendado: 7 días).  
  > • *Carga animal:* 180 novillos.  
  > • *Semáforo de lotes linderos:*  
  >    - **Corral 2:** 🟢 **Óptimo** (38 días de descanso acumulados, listo para pastoreo).  
  >    - **Corral 3:** 🟡 **Rebrote** (14 días de descanso, no ingresar).  
  >   
  > 👉 *Recomendación:* Rotar los animales del lote **Bajo Grande** al lote **Corral 2** hoy mismo para asegurar el correcto descanso de la pastura.

---

### 6️⃣ 🧮 Formulación de Mixer
* **Descripción:** Calculá raciones de materia seca (MS) y ración húmeda diaria en segundos. Seleccioná el tipo de dieta (Feedlot, Suplementación, Pastura) e ingresá peso vivo y cantidad de cabezas para obtener la mezcla justa.
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«calculame la racion para 150 novillos en feedlot de 320 kg»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 🧮 **Formulación de Mixer (Feedlot - Terminación)**  
  > ━━━━━━━━━━━━━━━━━━━━  
  > 👥 *Cabezas:* 150 novillos | ⚖️ *Peso promedio:* 320 kg  
  > 🌿 *Consumo diario total:* 1.344 kg de Materia Seca (MS) / día (2.8% PV).  
  >   
  > 📊 *Ración húmeda por mezcla para cargar al Mixer:*  
  > 1. 🌽 **Silo de maíz (50% MS):** 1.493 kg húmedos.  
  > 2. 🌾 **Maíz quebrado (30% MS):** 448 kg húmedos.  
  > 3. 🧪 **Harina de soja (15% MS):** 244 kg húmedos.  
  > 4. 🧂 **Premix / Núcleo (5% MS):** 71 kg húmedos.  
  >   
  > 🚚 *Total mezcla mixer:* **2.256 kg húmedos** por día para el rodeo.

---

### 7️⃣ 📄 Planillas PDF Oficiales
* **Descripción:** Exportá fichas de trazabilidad de caravanas e historiales clínicos con formato profesional y firmas homologadas para manga de veterinarios y productores con un solo click.
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«necesito la planilla de trazabilidad de los terneros para el veterinario»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 📄 *AGROHABILIS - EXPORTACIÓN DE PLANILLAS PDF*  
  > ━━━━━━━━━━━━━━━━━━━━  
  > He preparado el reporte oficial homologado de **Trazabilidad de Caravanas** para tu establecimiento en *Tandil*.  
  >   
  > Este documento está certificado con firma de manga autorizada y grilla para anotaciones del SENASA.  
  >   
  > 🔗 *Descargalo al instante haciendo click acá:*  
  > [https://agro.habilispro.com/cliente.html](https://agro.habilispro.com/cliente.html)  
  >   
  > _(Entrá al portal, andá a la pestaña "Hacienda" y presioná "Exportar Planilla PDF" al lado de la hacienda registrada)._

---

### 8️⃣ 💹 Precios, Fletes y Arbitraje
* **Descripción:** Precios del mercado físico (disponible) y futuros (MATBA/ROFEX). **Calculá fletes en tiempo real ajustados por gasoil y peajes, y compará ofertas locales contra el puerto con nuestra calculadora inteligente de arbitraje.**
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«tengo 120 tn de soja en silo en Tandil, me conviene vender en Necochea o Bahía Blanca?»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 💹 **Calculadora de Arbitraje y Logística Inteligente:**  
  > ━━━━━━━━━━━━━━━━━━━━  
  > 🌾 *Plazas de Destino Analizadas (22-05-2026):*  
  >   
  > • **Puerto Bahía Blanca:**  
  >    - *Precio spot:* $477.972 ARS/tn.  
  >    - *Costo de flete:* $30.940 ARS/tn (CATAC, peaje incluido).  
  >    - *Neto en origen:* **$447.032 ARS/tn**.  
  >   
  > • **Puerto Necochea (Quequén):**  
  >    - *Precio spot:* $465.000 ARS/tn.  
  >    - *Costo de flete:* $18.500 ARS/tn.  
  >    - *Neto en origen:* **$446.500 ARS/tn**.  
  >   
  > 👉 *Conclusión:*  
  > Te conviene despachar a **Bahía Blanca**. A pesar de estar más lejos, la brecha de precio compensa el costo del flete, otorgándote una **ganancia neta extra de +$532/tn** (+$63.840 adicionales netos por las 120 toneladas totales).

---

### 9️⃣ 🌤️ Pronóstico de Precisión
* **Descripción:** Clima local ultra-preciso para tu establecimiento. Recibí alertas tempranas de heladas, tormentas o condiciones ideales (viento y humedad) para la aplicación de agroquímicos agrícolas.
* **Interacción Simulada:**
  > 🧑🌾 **Productor:** *«se puede fumigar mañana temprano en el lote 5?»*  
  >   
  > 🤖 **AgroHabilis:**  
  > 🌤️ **Condiciones de Aplicación Agrícola - Lote 5**  
  > ━━━━━━━━━━━━━━━━━━━━  
  > 📅 *Mañana Temprano (07:00 a 10:00 AM):*  
  >   
  > • 🌡️ *Temperatura:* 9°C a 12°C (🟢 Excelente).  
  > • 💧 *Humedad Relativa:* 72% (🟢 Óptimo, evita evaporación rápida).  
  > • 💨 *Viento:* Sudoeste a 6 km/h (🟢 Muy bueno, bajo riesgo de deriva).  
  >   
  > 👉 *Veredicto:* **VENTANA DE APLICACIÓN ÓPTIMA.** Las condiciones meteorológicas son perfectas para pulverización hidráulica de contacto. Se sugiere concretar la labor antes del mediodía, ya que por la tarde se prevén ráfagas superiores a 18 km/h.

---

## 4. MODELO DE NEGOCIO Y MONETIZACIÓN

### Filosofía Comercial: *Unbundled Features* (Funciones sin Barreras)
El **100% de las funciones avanzadas** (clima geolocalizado, trazabilidad SENASA, análisis de fotos de malezas y calculadora financiera de margen) están **desbloqueadas para todos los planes desde el primer día**. El crecimiento y monetización se escalan orgánicamente según la frecuencia de uso del productor, medida en **mensajes semanales procesados**.

```
========================================================================
         ESQUEMA 3: VISTA DE CONTROL - PANEL WEB PREMIUM (cliente.html)
========================================================================
  [ Hacienda & Trazabilidad ]      [ Rotación Pasturas ]    [ Finanzas ]
  Caravana AR-105: ⚠️ RETIRO       Lote Corral 2: 🟢 OPTIMO  Monto: $4.890.000
  Caravana AR-108: 🟢 APTO FAENA   Lote Bajo Gde: 🔴 OCUPADO Margen: ▲ +14.5%
========================================================================
```

### Tabla Comparativa de Planes Vigentes

| Característica | 🆓 PLAN GRATIS | 🟢 PLAN BÁSICO | 🟡 PLAN PRO | 🔥 PLAN PRO MAX |
| :--- | :---: | :---: | :---: | :---: |
| **Precio Mensual** | **$0 ARS** | **$9.000 ARS** | **$18.000 ARS** | **$50.000 ARS** |
| **Cupo de Mensajes** | 15 mensajes / semana | 50 mensajes / semana | 150 mensajes / semana | **Ilimitado** |
| **Establecimientos / Zonas** | Máximo 1 zona | Hasta 3 zonas | Hasta 6 zonas | **Ilimitadas** |
| **Portal Web Premium** | No disponible | **Acceso Completo** | **Acceso Completo** | **Acceso Completo** |
| **Exportación PDF/Excel** | No disponible | No disponible | **Incluido** | **Incluido** |
| **Soporte Técnico** | Por comunidad | Soporte estándar | Soporte estándar | **Soporte Prioritario 24/7** |

---

## 5. ROADMAP Y ESCALABILIDAD (Hacia dónde vamos)

### Migración Nativa a la API Oficial de Meta
Toda la lógica del backend y los enrutadores de chat están **completamente aislados y desacoplados del canal físico de mensajería** gracias a una robusta capa de abstracción contenida en `whatsappService.js`.

### Beneficios Corporativos de la WhatsApp Business API Oficial:
* **Riesgo Cero de Baneo:** Operación certificada con servidores dedicados de Meta (99.9% uptime).
* **Identidad de Marca Confiable (Display Name):** Nombre oficial **"AgroHabilis"** con **insignia verde de verificación**.
* **Interacciones Premium con Botones:** Listas desplegables y botones interactivos ("Confirmar", "Registrar Gasto").
* **Notificaciones Masivas Automatizadas (Webhooks):** Envío masivo de reportes matutinos a bajísimo costo.
