/**
 * cursor-overlay.js
 * Se inyecta en el contexto del browser (addInitScript) para mostrar
 * un cursor visual rojo que sigue los movimientos sintéticos de Playwright.
 *
 * Expone window.__CURSOR__ con métodos de control.
 */
(function () {
  if (window.__CURSOR__) return; // evitar doble inyección

  const DOT_SIZE = 28;
  const RING_SIZE = 48;

  // --- Crear elementos ---
  const dot = document.createElement('div');
  dot.id = '__pw_cursor_dot__';
  Object.assign(dot.style, {
    position: 'fixed',
    width:  DOT_SIZE + 'px',
    height: DOT_SIZE + 'px',
    borderRadius: '50%',
    background: 'rgba(239, 68, 68, 0.92)',
    border: '2px solid rgba(255,255,255,0.9)',
    boxShadow: '0 0 12px 4px rgba(239,68,68,0.55), 0 2px 6px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-50%, -50%)',
    transition: 'left 0.07s linear, top 0.07s linear',
    left: '-100px',
    top:  '-100px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    willChange: 'left, top',
  });

  // Anillo exterior animado
  const ring = document.createElement('div');
  ring.id = '__pw_cursor_ring__';
  Object.assign(ring.style, {
    position: 'fixed',
    width:  RING_SIZE + 'px',
    height: RING_SIZE + 'px',
    borderRadius: '50%',
    border: '2px solid rgba(239,68,68,0.55)',
    pointerEvents: 'none',
    zIndex: '2147483646',
    transform: 'translate(-50%, -50%)',
    transition: 'left 0.15s ease, top 0.15s ease',
    left: '-100px',
    top:  '-100px',
    willChange: 'left, top',
  });

  // Label de texto (muestra el paso actual)
  const label = document.createElement('div');
  label.id = '__pw_cursor_label__';
  Object.assign(label.style, {
    position: 'fixed',
    background: 'rgba(15, 23, 42, 0.88)',
    color: '#f1f5f9',
    fontSize: '12px',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: '700',
    padding: '4px 10px',
    borderRadius: '20px',
    border: '1px solid rgba(239,68,68,0.4)',
    pointerEvents: 'none',
    zIndex: '2147483645',
    left: '-200px',
    top:  '-200px',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    transition: 'left 0.07s linear, top 0.07s linear, opacity 0.3s ease',
    opacity: '0',
    willChange: 'left, top',
  });

  function mount() {
    if (!document.body) { setTimeout(mount, 100); return; }
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.appendChild(label);
  }
  mount();

  let _cx = -100, _cy = -100;

  // Seguir el mouse real (cuando el humano mueve el mouse también se ve)
  document.addEventListener('mousemove', (e) => {
    _cx = e.clientX; _cy = e.clientY;
    dot.style.left  = _cx + 'px';
    dot.style.top   = _cy + 'px';
    ring.style.left = _cx + 'px';
    ring.style.top  = _cy + 'px';
    label.style.left = (_cx + 20) + 'px';
    label.style.top  = (_cy - 30) + 'px';
  });

  // API pública para uso desde Playwright via page.evaluate()
  window.__CURSOR__ = {
    /**
     * Mover el cursor a coordenadas absolutas (viewport)
     * @param {number} x
     * @param {number} y
     */
    moveTo(x, y) {
      _cx = x; _cy = y;
      dot.style.left  = x + 'px';
      dot.style.top   = y + 'px';
      ring.style.left = x + 'px';
      ring.style.top  = y + 'px';
      label.style.left = (x + 20) + 'px';
      label.style.top  = (y - 30) + 'px';
    },

    /**
     * Mostrar texto flotante junto al cursor
     * @param {string} text
     */
    setLabel(text) {
      label.textContent = text;
      label.style.opacity = text ? '1' : '0';
    },

    /**
     * Animación de clic (pulso rojo)
     */
    click() {
      dot.style.transform = 'translate(-50%, -50%) scale(0.65)';
      ring.style.transform = 'translate(-50%, -50%) scale(1.8)';
      ring.style.opacity = '0.2';
      setTimeout(() => {
        dot.style.transform = 'translate(-50%, -50%) scale(1)';
        ring.style.transform = 'translate(-50%, -50%) scale(1)';
        ring.style.opacity = '1';
      }, 220);
    },

    /** Ocultar cursor */
    hide() {
      dot.style.opacity = '0';
      ring.style.opacity = '0';
      label.style.opacity = '0';
    },

    /** Mostrar cursor */
    show() {
      dot.style.opacity = '1';
      ring.style.opacity = '1';
    },
  };

  console.info('[CursorOverlay] inyectado correctamente ✓');
})();
