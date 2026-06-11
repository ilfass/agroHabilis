const { AsyncLocalStorage } = require("async_hooks");
const iaRequestContext = new AsyncLocalStorage();

// Respaldar la clave original gratuita cargada en el arranque del servidor
const originalFreeKey = process.env.GEMINI_API_KEY?.trim() || "";

const keysPool = (() => {
  const poolEnv = process.env.GEMINI_API_KEY_POOL;
  if (poolEnv) {
    return poolEnv
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }
  const pool = [];
  if (originalFreeKey) {
    pool.push(originalFreeKey);
  }
  const fallback = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (fallback) {
    pool.push(fallback);
  }
  return pool;
})();

let activeKeyIndex = 0;
const failedKeys = new Set();

// Asegurar que process.env.GEMINI_API_KEY esté inicializado con la primera del pool
if (keysPool.length > 0) {
  process.env.GEMINI_API_KEY = keysPool[activeKeyIndex];
}

/**
 * Obtiene la API Key de Gemini activa de forma dinámica.
 */
const getGeminiApiKey = () => {
  return process.env.GEMINI_API_KEY?.trim() || null;
};

/**
 * Marca si la clave actual falló por cuota/límites.
 * Si falla, conmuta dinámicamente process.env.GEMINI_API_KEY a la siguiente clave disponible en el pool.
 */
const markFreeKeyAsFailed = (failed = true) => {
  if (keysPool.length <= 1) {
    return; // No hay pool de claves alternativas configuradas
  }

  if (failed) {
    const currentKey = getGeminiApiKey();
    if (currentKey) {
      failedKeys.add(currentKey);
    }

    if (failedKeys.size >= keysPool.length) {
      console.warn("[Gemini Keys] 🔄 Todas las claves del pool fallaron por límites de cuota. Reiniciando lista para reintentar.");
      failedKeys.clear();
    }

    let found = false;
    for (let i = 0; i < keysPool.length; i++) {
      const nextIdx = (activeKeyIndex + i + 1) % keysPool.length;
      const candidate = keysPool[nextIdx];
      if (!failedKeys.has(candidate)) {
        activeKeyIndex = nextIdx;
        process.env.GEMINI_API_KEY = candidate;
        found = true;
        console.warn(`[Gemini Keys] ⚠️ La clave Gemini index ${activeKeyIndex - 1 < 0 ? keysPool.length - 1 : activeKeyIndex - 1} falló. Conmutando en caliente a clave index ${activeKeyIndex} (ends with: ...${candidate.slice(-6)}).`);
        break;
      }
    }
  } else {
    // Restablecer al estado original
    failedKeys.clear();
    activeKeyIndex = 0;
    if (keysPool.length > 0) {
      process.env.GEMINI_API_KEY = keysPool[0];
    }
    console.log("[Gemini Keys] 🔄 Restableciendo pool al estado original (Clave 0 activa).");
  }
};

/**
 * Retorna el estado actual de las claves para diagnóstico en el panel web.
 */
const getGeminiApiKeyStatus = () => {
  if (keysPool.length === 0) {
    return { activeKeyType: "no_configurada", label: "Sin configurar" };
  }
  const current = getGeminiApiKey();
  const fallbackKey = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  const isPaid = !!(current && fallbackKey && current === fallbackKey);
  return {
    activeKeyIndex,
    totalKeys: keysPool.length,
    failedKeysCount: failedKeys.size,
    activeKeyType: isPaid ? "paga" : "gratuita", // mantiene compatibilidad con verificadores de tests
    label: `Clave ${activeKeyIndex + 1}/${keysPool.length} activa (ends with: ...${current ? current.slice(-6) : "none"})${failedKeys.size ? ` [Fallidas: ${failedKeys.size}]` : ""}`
  };
};

module.exports = {
  getGeminiApiKey,
  markFreeKeyAsFailed,
  getGeminiApiKeyStatus,
  iaRequestContext,
  keysPool
};
