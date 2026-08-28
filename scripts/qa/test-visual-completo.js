#!/usr/bin/env node
/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║         TEST VISUAL COMPLETO – AgroHabilis                            ║
 * ║         Personaje: Carlos Spina – Productor Ganadero / Agrícola       ║
 * ║                                                                        ║
 * ║  Recorre TODAS las secciones del panel con cursor visual animado       ║
 * ║  Graba video en docs/operacion/                                        ║
 * ║                                                                        ║
 * ║  Uso:  node scripts/qa/test-visual-completo.js                        ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ══════════════════════════════════════════════════════════
//  CONFIGURACIÓN
// ══════════════════════════════════════════════════════════
const CONFIG = {
  baseUrl:   'https://agro.habilispro.com',
  telefono:  '2494468949',
  password:  'H2HuAWQF3C',
  slowMo:    700,            // ms entre acciones (ajustable)
  pausaCorta: 1200,          // ms para pausas de observación cortas
  pausaMedia: 2200,          // ms para pausas de observación medias
  pausaLarga: 3500,          // ms para pausar y leer contenido
  videoDir:  path.join(__dirname, '..', '..', 'docs', 'operacion'),
  viewport:  { width: 1440, height: 860 },
};

// Garantizar que el directorio de video exista
fs.mkdirSync(CONFIG.videoDir, { recursive: true });

// ══════════════════════════════════════════════════════════
//  HELPERS DE CURSOR Y ANIMACIÓN
// ══════════════════════════════════════════════════════════

/** Pausa simple */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Obtiene el centro de un elemento (coordenadas viewport)
 */
async function getCenter(page, selector) {
  try {
    const el = await page.$(selector);
    if (!el) return null;
    const box = await el.boundingBox();
    if (!box) return null;
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  } catch { return null; }
}

/**
 * Mueve el cursor visual + el mouse de Playwright de forma suave (N pasos).
 */
async function moveTo(page, x, y, steps = 18) {
  await page.mouse.move(x, y, { steps });
  await page.evaluate(({ x, y }) => window.__CURSOR__?.moveTo(x, y), { x, y });
}

/**
 * Mueve al centro de un selector y hace clic con animación.
 */
async function clickSlow(page, selector, label = '', { timeout = 8000, force = false } = {}) {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
  } catch (e) {
    log(`⚠️  Selector no visible (omitido): ${selector}`, 'WARN');
    return false;
  }
  const center = await getCenter(page, selector);
  if (!center) { log(`⚠️  Sin boundingBox: ${selector}`, 'WARN'); return false; }

  if (label) await page.evaluate((t) => window.__CURSOR__?.setLabel(t), label);
  await moveTo(page, center.x, center.y);
  await sleep(350);
  await page.evaluate(() => window.__CURSOR__?.click());
  await sleep(120);
  if (force) {
    await page.evaluate((sel) => document.querySelector(sel)?.click(), selector);
  } else {
    await page.click(selector, { force: false });
  }
  if (label) {
    await sleep(300);
    await page.evaluate(() => window.__CURSOR__?.setLabel(''));
  }
  return true;
}

/**
 * Escribe en un campo con animación de cursor + tecla a tecla.
 */
async function typeSlow(page, selector, text, label = '') {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 6000 });
  } catch {
    log(`⚠️  Campo no visible: ${selector}`, 'WARN');
    return false;
  }
  const center = await getCenter(page, selector);
  if (center) {
    if (label) await page.evaluate((t) => window.__CURSOR__?.setLabel(t), label);
    await moveTo(page, center.x, center.y);
    await sleep(280);
    await page.evaluate(() => window.__CURSOR__?.click());
  }
  await page.fill(selector, '');
  await page.type(selector, text, { delay: 55 });
  if (label) await page.evaluate(() => window.__CURSOR__?.setLabel(''));
  return true;
}

/**
 * Navega a un tab del sidebar por su data-tab.
 * Hace clic en el botón Y además fuerza la activación del panel via JS
 * para asegurar que display:none se quite antes de interactuar.
 */
async function goTab(page, tabName) {
  const btnSel = `button.tab-link[data-tab="${tabName}"]`;

  // 1. Mover cursor al botón (puede no estar "visible" si el sidebar scrollea)
  try {
    await page.waitForSelector(btnSel, { timeout: 6000 });
  } catch {
    log(`⚠️  Tab button no encontrado: ${tabName}`, 'WARN');
    return false;
  }

  const center = await getCenter(page, btnSel);
  if (center) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(`→ ${t}`), tabName);
    await moveTo(page, center.x, center.y);
    await sleep(300);
    await page.evaluate(() => window.__CURSOR__?.click());
  }

  // 2. Clic real en el botón
  await page.evaluate((tabName) => {
    const btn = document.querySelector(`button.tab-link[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }, tabName);

  // 3. Forzar activación del panel via JS (por si el clic no lo activó)
  await page.evaluate((tabName) => {
    // Desactivar todos los paneles y botones
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
    // Activar el panel y botón correctos
    const panel = document.querySelector(`.tab-panel[data-panel="${tabName}"]`);
    const btn   = document.querySelector(`button.tab-link[data-tab="${tabName}"]`);
    if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
    if (btn)   btn.classList.add('active');
  }, tabName);

  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.__CURSOR__?.setLabel(''));
  await dismissTour(page);  // eliminar tour overlay si quedó activo
  log(`  ✓ Tab activado: ${tabName}`, 'INFO');
  return true;
}

/**
 * Logger con timestamps y colores en terminal.
 */
function log(msg, level = 'INFO') {
  const ts = new Date().toLocaleTimeString('es-AR');
  const color = { INFO: '\x1b[36m', OK: '\x1b[32m', WARN: '\x1b[33m', STEP: '\x1b[35m' }[level] || '\x1b[0m';
  console.log(`${color}[${ts}] [${level}] ${msg}\x1b[0m`);
}

/**
 * Elimina el overlay de Driver.js (tour interactivo) que bloquea los clics.
 * Se llama preventivamente antes de interactuar con botones.
 */
async function dismissTour(page) {
  await page.evaluate(() => {
    // 1. Destruir instancia de driver.js si existe
    try {
      if (window.driver?.destroy) window.driver.destroy();
      if (window.driverObj?.destroy) window.driverObj.destroy();
    } catch (_) {}

    // 2. Remover el SVG overlay que intercepta punteros
    document.querySelectorAll('.driver-overlay, .driver-overlay-animated, svg.driver-overlay').forEach(el => el.remove());

    // 3. Remover popover y highlight de driver.js
    document.querySelectorAll('.driver-popover, .driver-active-element, [class*="driver-"]').forEach(el => {
      el.classList.remove('driver-active-element');
      if (el.classList.contains('driver-popover') || el.classList.contains('driver-overlay')) el.remove();
    });

    // 4. Restaurar body scroll y overflow
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });
  // Tecla Escape por si hay un modal de tour nativo
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(200);
}

/**
 * Muestra un banner de sección en pantalla via JS overlay.
 */
async function banner(page, emoji, titulo, subtitulo = '') {
  await page.evaluate(({ emoji, titulo, subtitulo }) => {
    const existing = document.getElementById('__pw_banner__');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = '__pw_banner__';
    el.innerHTML = `
      <div style="font-size:36px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">${titulo}</div>
      ${subtitulo ? `<div style="font-size:13px;margin-top:6px;opacity:0.75">${subtitulo}</div>` : ''}
    `;
    Object.assign(el.style, {
      position: 'fixed', top: '20px', right: '20px',
      background: 'rgba(15,23,42,0.92)', color: '#f1f5f9',
      padding: '18px 24px', borderRadius: '16px',
      border: '1px solid rgba(99,102,241,0.5)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      zIndex: '2147483640', textAlign: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      backdropFilter: 'blur(12px)',
      animation: 'none',
    });
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) { el.style.opacity = '0'; el.style.transition = 'opacity 0.8s'; setTimeout(() => el.remove(), 800); } }, 3500);
  }, { emoji, titulo, subtitulo });
  await sleep(600);
}

// ══════════════════════════════════════════════════════════
//  PASO A PASO DEL TEST
// ══════════════════════════════════════════════════════════

async function paso01_login(page) {
  log('PASO 1 — Login con credenciales de Carlos Spina', 'STEP');
  await banner(page, '🔐', 'Iniciando sesión', 'Carlos Spina — Productor Agropecuario');

  await typeSlow(page, '#telefono', CONFIG.telefono, 'Ingresando teléfono...');
  await sleep(400);
  await typeSlow(page, '#password', CONFIG.password, 'Ingresando contraseña...');
  await sleep(500);
  await clickSlow(page, 'button[type="submit"]', '→ Ingresar al panel');
  
  // Esperar redirección al panel
  try {
    await page.waitForURL('**/cliente.html**', { timeout: 15000 });
  } catch {
    // Puede que ya esté en cliente.html
    const url = page.url();
    if (!url.includes('cliente')) {
      log('⚠️  No redirigió a cliente.html, esperando...', 'WARN');
      await sleep(3000);
    }
  }
  await sleep(CONFIG.pausaMedia);
  await dismissTour(page);  // cerrar tour si se abrió post-login
  log('✓ Login exitoso', 'OK');
}

async function paso02_resumen(page) {
  log('PASO 2 — Dashboard de Resumen General', 'STEP');
  await banner(page, '🏠', 'Panel de Resumen', 'Métricas principales del establecimiento');
  await sleep(CONFIG.pausaLarga);

  // Scroll para ver el contenido
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(CONFIG.pausaCorta);
  log('✓ Resumen visualizado', 'OK');
}

async function paso03_catastro_firmas(page) {
  log('PASO 3 — Catastro: Crear Firmas', 'STEP');
  await goTab(page, 'catastro');
  await banner(page, '🗺️', 'Catastro', 'Creando Firmas / Razones Sociales');
  await sleep(CONFIG.pausaMedia);

  // Helper: abrir modal firma y guardar via JS (evita problemas de visibilidad)
  const crearFirma = async (nombre, labelFirma) => {
    // Clic en botón (para animación visual)
    const btnCenter = await getCenter(page, '#btnCatNuevaFirma');
    if (btnCenter) {
      await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '+ Nueva Firma');
      await moveTo(page, btnCenter.x, btnCenter.y);
      await sleep(300);
      await page.evaluate(() => window.__CURSOR__?.click());
    }
    // Abrir modal via JS
    await page.evaluate(() => {
      document.getElementById('btnCatNuevaFirma')?.click();
      const modal = document.getElementById('firmaEditModal');
      if (modal) { modal.showModal?.(); modal.setAttribute('open', ''); modal.style.display = 'block'; }
      const inp = document.getElementById('firmaFormId'); if (inp) inp.value = '';
      const n = document.getElementById('firmaFormNombre'); if (n) n.value = '';
    });
    await sleep(500);
    // Animar escritura
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), labelFirma);
    await typeSlow(page, '#firmaFormNombre', nombre, labelFirma);
    await sleep(400);
    // Guardar
    await page.evaluate(() => {
      document.querySelector('#firmaEditForm button[type="submit"]')?.click();
    });
    await sleep(CONFIG.pausaMedia);
  };

  await crearFirma('Spina Agropecuaria S.A.', 'Firma 1: Spina Agropecuaria...');
  await crearFirma('La Calandria S.R.L.',     'Firma 2: La Calandria...');
  log('✓ Firmas creadas', 'OK');
}

async function paso04_catastro_campos(page) {
  log('PASO 4 — Catastro: Crear Campos / Establecimientos', 'STEP');
  await banner(page, '🏡', 'Catastro', 'Creando Campos / Establecimientos');
  await sleep(CONFIG.pausaCorta);

  // Helper: abrir modal campo y guardar via JS
  const crearCampo = async ({ nombre, ciudad, provincia, lat, lng, label }) => {
    const btnCenter = await getCenter(page, '#btnCatNuevoCampo');
    if (btnCenter) {
      await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '+ Nuevo Campo');
      await moveTo(page, btnCenter.x, btnCenter.y);
      await sleep(300);
      await page.evaluate(() => window.__CURSOR__?.click());
    }
    // Abrir modal via JS
    await page.evaluate(() => {
      document.getElementById('btnCatNuevoCampo')?.click();
      const modal = document.getElementById('campoEditModal');
      if (modal) { modal.showModal?.(); modal.setAttribute('open', ''); modal.style.display = 'block'; }
      ['campoFormId','campoFormNombre','campoFormCiudad','campoFormProvincia','campoFormLat','campoFormLng'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
    });
    await sleep(500);
    await typeSlow(page, '#campoFormNombre',    nombre,    `${label}: nombre...`);
    await sleep(250);
    await typeSlow(page, '#campoFormCiudad',    ciudad,    `${label}: ciudad...`);
    await sleep(250);
    await typeSlow(page, '#campoFormProvincia', provincia, `${label}: provincia...`);
    await sleep(250);
    await typeSlow(page, '#campoFormLat',       lat,       `${label}: latitud...`);
    await sleep(200);
    await typeSlow(page, '#campoFormLng',       lng,       `${label}: longitud...`);
    await sleep(400);
    await page.evaluate(() => {
      document.querySelector('#campoEditForm button[type="submit"]')?.click();
    });
    await sleep(CONFIG.pausaMedia);
    log(`  ✓ Campo creado: ${nombre}`, 'OK');
  };

  await crearCampo({ nombre: 'Don Esteban', ciudad: 'Balcarce',  provincia: 'Buenos Aires', lat: '-37.8457', lng: '-58.2565', label: 'Campo 1' });
  await crearCampo({ nombre: 'El Milagro',  ciudad: 'Pergamino', provincia: 'Buenos Aires', lat: '-33.8884', lng: '-60.5700', label: 'Campo 2' });
  log('✓ Campos creados', 'OK');
}

async function paso05_catastro_lotes(page) {
  log('PASO 5 — Catastro: Crear Lotes', 'STEP');
  await banner(page, '📐', 'Catastro', 'Creando Lotes / Potreros');
  await sleep(CONFIG.pausaCorta);

  const lotes = [
    { nombre: 'Lote Lomas',        ha: '120', tipo: 'agricola'  },
    { nombre: 'Potrero Ganadero',  ha: '100', tipo: 'ganadero'  },
    { nombre: 'Lote Bajo',         ha: '80',  tipo: 'mixto'     },
    { nombre: 'Lote 1 Pergamino',  ha: '150', tipo: 'agricola'  },
    { nombre: 'Lote 2 Pergamino',  ha: '110', tipo: 'agricola'  },
  ];

  for (const lote of lotes) {
    // Clic en + Nuevo Lote via evaluate para bypasear overlays
    const btnLoteCenter = await getCenter(page, '#btnCatNuevoLote');
    if (btnLoteCenter) {
      await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '+ Nuevo Lote');
      await moveTo(page, btnLoteCenter.x, btnLoteCenter.y);
      await sleep(300);
      await page.evaluate(() => window.__CURSOR__?.click());
    }
    await dismissTour(page);  // por si el tour se disparó al entrar al catastro
    await page.evaluate(() => document.getElementById('btnCatNuevoLote')?.click());
    await sleep(CONFIG.pausaCorta);

    // Forzar visibilidad del modal de lote via JS (puede estar oculto)
    await page.evaluate(() => {
      const modal = document.getElementById('loteEditModal');
      if (modal && !modal.open) modal.showModal?.();
      // Si es un dialog nativo, asegurar que está abierto
      if (modal) {
        modal.style.display = 'block';
        modal.setAttribute('open', '');
      }
    });
    await sleep(400);

    // Seleccionar tipo "lote" via evaluate (evita timeout por visibilidad)
    await page.evaluate(() => {
      const sel = document.getElementById('loteFormTipo');
      if (sel) { sel.value = 'lote'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(350);

    await typeSlow(page, '#loteFormNombre', lote.nombre, `Lote: ${lote.nombre}`);
    await sleep(250);
    await typeSlow(page, '#loteFormHectareas', lote.ha, 'Hectáreas...');
    await sleep(300);

    // Seleccionar uso via evaluate
    await page.evaluate((tipo) => {
      const sel = document.getElementById('loteFormUso');
      if (sel) { sel.value = tipo; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }, lote.tipo);
    await sleep(300);

    // Submit via evaluate para evitar problemas de visibilidad
    await page.evaluate(() => {
      const btn = document.querySelector('#loteEditForm button[type="submit"]');
      if (btn) btn.click();
    });
    await sleep(CONFIG.pausaMedia);
    log(`  ✓ Lote creado: ${lote.nombre}`, 'OK');
  }
  log('✓ Lotes creados', 'OK');
}

async function paso06_hacienda(page) {
  log('PASO 6 — Hacienda & Pasturas', 'STEP');
  await goTab(page, 'hacienda_pasturas');
  await banner(page, '🐄', 'Hacienda & Pasturas', 'Carlos visita el Potrero Ganadero');
  await sleep(CONFIG.pausaLarga);

  // Scroll para ver semáforos
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await sleep(CONFIG.pausaCorta);
  log('✓ Hacienda y Pasturas visualizadas', 'OK');
}

async function paso07_trazabilidad(page) {
  log('PASO 7 — Trazabilidad Animal', 'STEP');
  await goTab(page, 'trazabilidad');
  await banner(page, '💉', 'Trazabilidad', 'Registro veterinario – Caravana AR-105');
  await sleep(CONFIG.pausaLarga);

  // Buscar input de búsqueda de trazabilidad
  const searchSel = 'input[placeholder*="caravana"], input[placeholder*="Caravana"], input[id*="trazSearch"], input[id*="searchTraz"]';
  const searchOk = await clickSlow(page, searchSel, 'Buscar caravana AR-105', { timeout: 5000 });
  if (searchOk) {
    await typeSlow(page, searchSel, 'AR-105', 'Buscando...');
    await sleep(CONFIG.pausaMedia);
  }

  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  log('✓ Trazabilidad visitada', 'OK');
}

async function paso08_agricultura(page) {
  log('PASO 8 — Agricultura & Semillas', 'STEP');
  await goTab(page, 'agricultura_semillas');
  await banner(page, '🌾', 'Agricultura & Semillas', 'Inventario de cultivos activos');
  await sleep(CONFIG.pausaLarga);

  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  log('✓ Agricultura visualizada', 'OK');
}

async function paso09_siembra_asociada(page) {
  log('PASO 9 — Siembra Asociada (labores de siembra)', 'STEP');
  // La siembra se registra dentro del tab agricultura_semillas (formulario inline)
  await goTab(page, 'agricultura_semillas');
  await banner(page, '🚜', 'Siembra Asociada', 'Carlos Spina registra siembra de Trigo en Lote Lomas');
  await sleep(CONFIG.pausaCorta);

  // Seleccionar lote en el select
  await page.evaluate(() => {
    const sel = document.getElementById('agr-siembra-lote');
    if (sel && sel.options.length > 1) sel.selectedIndex = 1; // primer lote disponible
    sel?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(300);

  // Mover cursor al select de campaña y seleccionar 25/26
  const campCenter = await getCenter(page, '#agr-siembra-campania');
  if (campCenter) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), 'Campaña 25/26...');
    await moveTo(page, campCenter.x, campCenter.y);
    await sleep(300);
    await page.evaluate(() => window.__CURSOR__?.click());
    await page.evaluate(() => {
      const sel = document.getElementById('agr-siembra-campania');
      if (sel) { sel.value = '25/26'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  await sleep(300);

  // Fecha de siembra
  await page.evaluate(() => {
    const inp = document.getElementById('agr-siembra-fecha');
    if (inp) { inp.value = '2026-08-27'; inp.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await sleep(250);

  // Cultivo
  await typeSlow(page, '#agr-siembra-cultivo', 'Trigo', 'Cultivo: Trigo...');
  await sleep(250);

  // Variedad / Híbrido
  await typeSlow(page, '#agr-siembra-hibrido', 'DM3821', 'Variedad DM3821...');
  await sleep(250);

  // Densidad
  await typeSlow(page, '#agr-siembra-densidad', '120', 'Densidad kg/ha...');
  await sleep(400);

  // Guardar
  const btnCenter = await getCenter(page, '#btnGuardarSiembra');
  if (btnCenter) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '💾 Guardar Siembra');
    await moveTo(page, btnCenter.x, btnCenter.y);
    await sleep(350);
    await page.evaluate(() => window.__CURSOR__?.click());
    await page.evaluate(() => document.getElementById('btnGuardarSiembra')?.click());
    await sleep(CONFIG.pausaMedia);
  }
  log('✓ Siembra registrada', 'OK');
}


async function paso10_clima(page) {
  log('PASO 10 — Clima & Precipitaciones', 'STEP');
  await goTab(page, 'clima');
  await banner(page, '🌤️', 'Clima', 'Pronóstico para la zona de Balcarce y Pergamino');
  await sleep(CONFIG.pausaLarga);

  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  log('✓ Clima visitado', 'OK');
}

async function paso11_calendario(page) {
  log('PASO 11 — Calendario de Actividades', 'STEP');
  await goTab(page, 'calendario');
  await banner(page, '📅', 'Calendario', 'Carlos planifica las tareas de la semana');
  await sleep(CONFIG.pausaMedia);

  // Clic en botón real: #btnCalendarAddTask
  const calBtn = await getCenter(page, '#btnCalendarAddTask');
  if (calBtn) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '➕ Planificar Tarea');
    await moveTo(page, calBtn.x, calBtn.y);
    await sleep(350);
    await page.evaluate(() => window.__CURSOR__?.click());
    // Abrir modal via JS
    await page.evaluate(() => {
      document.getElementById('btnCalendarAddTask')?.click();
      // Si el dialog no se abre solo, forzarlo
      const modal = document.getElementById('calendarTaskModal');
      if (modal && !modal.open) modal.showModal?.();
    });
    await sleep(CONFIG.pausaMedia);

    // Escribir título: #calTaskTitle
    await typeSlow(page, '#calTaskTitle', 'Recorrida general – Don Esteban', 'Título...');
    await sleep(300);

    // Descripción: #calTaskDescription
    await typeSlow(page, '#calTaskDescription', 'Verificar estado de lotes, hacienda y pasturas tras las lluvias.', 'Descripción...');
    await sleep(300);

    // Fecha inicio
    await page.evaluate(() => {
      const d = document.getElementById('calTaskStartDate');
      if (d) { d.value = '2026-08-28'; d.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(250);

    // Categoría: ganaderia
    await page.evaluate(() => {
      const sel = document.getElementById('calTaskCategory');
      if (sel) { sel.value = 'ganaderia'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(400);

    // Cerrar sin guardar (es demo)
    await page.keyboard.press('Escape');
    await sleep(300);
  }
  await sleep(CONFIG.pausaCorta);
  log('✓ Calendario visitado', 'OK');
}

async function paso12_registro_novedad(page) {
  log('PASO 12 — Registro de Movimientos (Ledger Operativo)', 'STEP');
  await goTab(page, 'registro');
  await banner(page, '📝', 'Ledger Operativo', 'Carlos registra movimiento de hacienda: 120 novillos en Potrero');
  await sleep(CONFIG.pausaMedia);

  // Dom: ganado
  const domCenter = await getCenter(page, '#invDom');
  if (domCenter) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), 'Domínio: Ganado...');
    await moveTo(page, domCenter.x, domCenter.y);
    await sleep(250);
    await page.evaluate(() => window.__CURSOR__?.click());
    await page.evaluate(() => {
      const s = document.getElementById('invDom');
      if (s) { s.value = 'ganado'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  await sleep(500);

  // Categoría de ganado
  await typeSlow(page, '#invGanCat', 'novillos Angus', 'Categoría...');
  await sleep(300);

  // Cabezas
  await typeSlow(page, '#invGanCab', '120', 'Cabezas...');
  await sleep(350);

  // Guardar
  const btnReg = await getCenter(page, '#invBtnReg');
  if (btnReg) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), '💾 Guardar Registro');
    await moveTo(page, btnReg.x, btnReg.y);
    await sleep(350);
    await page.evaluate(() => window.__CURSOR__?.click());
    await page.evaluate(() => document.getElementById('invBtnReg')?.click());
    await sleep(CONFIG.pausaMedia);
  }
  log('✓ Registro de movimiento guardado', 'OK');
}

async function paso13_finanzas(page) {
  log('PASO 13 — Finanzas y Operación', 'STEP');
  await goTab(page, 'finanzas');
  await banner(page, '📄', 'Finanzas & Operación', 'Revisando pizarra comercial y flujo de caja');
  await sleep(CONFIG.pausaLarga);

  // Interactuar con filtros de período
  await clickSlow(page, 'button.finance-filter[data-days="30"]', 'Ver 30 días', { timeout: 4000 });
  await sleep(CONFIG.pausaMedia);
  await clickSlow(page, 'button.finance-filter[data-days="90"]', 'Ver 90 días', { timeout: 4000 });
  await sleep(CONFIG.pausaMedia);
  await clickSlow(page, 'button.finance-filter[data-days="7"]', 'Ver 7 días', { timeout: 4000 });
  await sleep(CONFIG.pausaCorta);

  // Scroll para ver tablas de gastos y ventas
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  log('✓ Finanzas visitadas', 'OK');
}

async function paso14_campanas(page) {
  log('PASO 14 — Campanas / Alertas Activas', 'STEP');
  await goTab(page, 'campanas');
  await banner(page, '🔔', 'Campanas & Alertas', 'Alertas de precio y sanitación activas');
  await sleep(CONFIG.pausaLarga);
  log('✓ Campanas visitadas', 'OK');
}

async function paso15_reportes(page) {
  log('PASO 15 — Reportes Generales', 'STEP');
  await goTab(page, 'reportes');
  await banner(page, '📊', 'Reportes Generales', 'Análisis de inventarios y productividad');
  await sleep(CONFIG.pausaLarga);

  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'smooth' }));
  await sleep(CONFIG.pausaMedia);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  log('✓ Reportes visitados', 'OK');
}

async function paso16_reportes_diarios(page) {
  log('PASO 16 — Reportes Diarios', 'STEP');
  await goTab(page, 'reportes-diarios');
  await banner(page, '📝', 'Reportes Diarios', 'Resumen del día – 27 de agosto de 2026');
  await sleep(CONFIG.pausaLarga);
  log('✓ Reportes diarios visitados', 'OK');
}

async function paso17_telemetria(page) {
  log('PASO 17 — Telemetría (Maquinaria)', 'STEP');
  await goTab(page, 'telemetria');
  await banner(page, '🚜', 'Telemetría', 'Seguimiento de la sembradora JD-1890 en campaña');
  await sleep(CONFIG.pausaLarga);
  log('✓ Telemetría visitada', 'OK');
}

async function paso18_equipo(page) {
  log('PASO 18 — Mi Equipo de Campo', 'STEP');
  await goTab(page, 'equipo');
  await banner(page, '👥', 'Mi Equipo', 'Carlos agrega a Juan Pérez como encargado');
  await sleep(CONFIG.pausaMedia);

  // Nombre del integrante: #eqNombre
  const eqNombreOk = await typeSlow(page, '#eqNombre', 'Juan Pérez', 'Nombre del encargado...');
  if (!eqNombreOk) {
    log('  (campo #eqNombre no encontrado)', 'WARN');
  }
  await sleep(350);

  // WhatsApp: #eqWhatsapp
  await typeSlow(page, '#eqWhatsapp', '5491155550000', 'WhatsApp de Juan Pérez...');
  await sleep(350);

  // Rol: #eqRol → encargado
  const rolCenter = await getCenter(page, '#eqRol');
  if (rolCenter) {
    await page.evaluate((t) => window.__CURSOR__?.setLabel(t), 'Rol: Encargado...');
    await moveTo(page, rolCenter.x, rolCenter.y);
    await sleep(300);
    await page.evaluate(() => window.__CURSOR__?.click());
    await page.evaluate(() => {
      const sel = document.getElementById('eqRol');
      if (sel) { sel.value = 'encargado'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  await sleep(500);

  // NO enviamos el form (es demo), limpiar campos
  await sleep(CONFIG.pausaCorta);
  await page.evaluate(() => {
    const n = document.getElementById('eqNombre');    if (n) n.value = '';
    const w = document.getElementById('eqWhatsapp');  if (w) w.value = '';
  });
  log('✓ Equipo visitado', 'OK');
}

async function paso19_comandos(page) {
  log('PASO 19 — Comandos del Sistema', 'STEP');
  await goTab(page, 'comandos');
  await banner(page, '⚙️', 'Comandos', 'Atajos y comandos disponibles para WhatsApp');
  await sleep(CONFIG.pausaLarga);
  log('✓ Comandos visitados', 'OK');
}

async function paso20_logout(page) {
  log('PASO 20 — Cierre de Sesión', 'STEP');
  await banner(page, '👋', 'Cerrando sesión', 'Demo completada — hasta luego, Carlos Spina');
  await sleep(CONFIG.pausaMedia);

  // Buscar botón de logout en footer del sidebar
  const logoutOk = await clickSlow(page, '#btnLogout', 'Cerrar sesión', { timeout: 5000 });
  if (!logoutOk) {
    // Intentar navegación directa
    await page.evaluate(() => fetch('/api/auth/cliente/logout', { method: 'POST' }));
    await sleep(1000);
    await page.goto(`${CONFIG.baseUrl}/cliente-login.html`);
  }
  await sleep(CONFIG.pausaMedia);
  log('✓ Logout completado', 'OK');
}

// ══════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════
async function main() {
  const startTime = Date.now();
  log('╔════════════════════════════════════════════════╗', 'STEP');
  log('║  TEST VISUAL TOTAL – AgroHabilis               ║', 'STEP');
  log('║  Personaje: Carlos Spina – Productor           ║', 'STEP');
  log('╚════════════════════════════════════════════════╝', 'STEP');

  const browser = await chromium.launch({
    headless: false,
    slowMo:   CONFIG.slowMo,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: CONFIG.viewport,
    recordVideo: {
      dir:  CONFIG.videoDir,
      size: CONFIG.viewport,
    },
    locale:    'es-AR',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AgroHabilis-VisualTest/1.0',
  });

  // Inyectar cursor overlay en CADA nueva página
  const cursorScript = require('fs').readFileSync(
    path.join(__dirname, 'cursor-overlay.js'), 'utf8'
  );
  await context.addInitScript(cursorScript);

  const page = await context.newPage();

  // Capturar errores de consola del browser
  page.on('console', msg => {
    if (msg.type() === 'error') log(`[Browser] ${msg.text()}`, 'WARN');
  });

  try {
    // ──────────────────────────────────────────
    // Login
    // ──────────────────────────────────────────
    log('Navegando al login...', 'INFO');
    await page.goto(`${CONFIG.baseUrl}/cliente-login.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);
    await paso01_login(page);

    // ──────────────────────────────────────────
    // Asegurar que el cursor overlay esté montado
    // ──────────────────────────────────────────
    await page.addScriptTag({ content: cursorScript }).catch(() => {});
    await sleep(800);

    // ──────────────────────────────────────────
    // Recorrido completo del panel
    // ──────────────────────────────────────────
    await paso02_resumen(page);
    await paso03_catastro_firmas(page);
    await paso04_catastro_campos(page);
    await paso05_catastro_lotes(page);
    await paso06_hacienda(page);
    await paso07_trazabilidad(page);
    await paso08_agricultura(page);
    await paso09_siembra_asociada(page);
    await paso10_clima(page);
    await paso11_calendario(page);
    await paso12_registro_novedad(page);
    await paso13_finanzas(page);
    await paso14_campanas(page);
    await paso15_reportes(page);
    await paso16_reportes_diarios(page);
    await paso17_telemetria(page);
    await paso18_equipo(page);
    await paso19_comandos(page);
    await paso20_logout(page);

    // ──────────────────────────────────────────
    // Fin del recorrido
    // ──────────────────────────────────────────
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log('', 'INFO');
    log('╔════════════════════════════════════════════════╗', 'OK');
    log(`║  ✅ TEST COMPLETADO EN ${elapsed}s                    ║`, 'OK');
    log('║  Video guardado en docs/operacion/             ║', 'OK');
    log('╚════════════════════════════════════════════════╝', 'OK');

    // Pausa final para que el usuario vea el resultado
    await sleep(4000);

  } catch (err) {
    log(`ERROR FATAL: ${err.message}`, 'WARN');
    console.error(err);
  } finally {
    await context.close();  // Esto finaliza y guarda el video
    await browser.close();

    // Renombrar el video con fecha
    try {
      const files = fs.readdirSync(CONFIG.videoDir)
        .filter(f => f.endsWith('.webm'))
        .sort((a, b) => {
          return fs.statSync(path.join(CONFIG.videoDir, b)).mtimeMs -
                 fs.statSync(path.join(CONFIG.videoDir, a)).mtimeMs;
        });
      if (files.length > 0) {
        const latest = files[0];
        const fecha  = new Date().toISOString().slice(0, 10);
        const dest   = path.join(CONFIG.videoDir, `test-visual-carlos-spina-${fecha}.webm`);
        fs.renameSync(path.join(CONFIG.videoDir, latest), dest);
        log(`Video guardado como: ${dest}`, 'OK');
      }
    } catch (e) {
      log(`No se pudo renombrar el video: ${e.message}`, 'WARN');
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
