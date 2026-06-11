import re

file_path = "/home/fabian/Documentos/Agro.habilispro/frontend/public/cliente.html"
with open(file_path, "r", encoding="utf-8") as f:
    html = f.read()

# ===== 1. Add Leaflet.draw CSS + JS imports after the existing Leaflet imports =====
leaflet_js_import = '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>'
leaflet_draw_imports = leaflet_js_import + """
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>"""

html = html.replace(leaflet_js_import, leaflet_draw_imports, 1)

# ===== 2. Replace the lote modal to add loteFormCampoId =====
old_modal = '''    <dialog id="loteEditModal" style="border: none; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 480px; background: white; color: #0f172a;">
      <h3 id="loteModalTitle" style="margin-top: 0; font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 18px; margin-bottom: 16px;">Editar Lote</h3>
      <form id="loteEditForm" style="display: flex; flex-direction: column; gap: 16px;">
        <input type="hidden" id="loteFormId" />
        
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="loteFormNombre" style="font-weight: 700; font-size: 12px; color: #475569;">Nombre del Lote / Corral</label>
          <input type="text" id="loteFormNombre" required style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormHectareas" style="font-weight: 700; font-size: 12px; color: #475569;">Hectáreas</label>
            <input type="number" id="loteFormHectareas" step="0.01" min="0" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormTipo" style="font-weight: 700; font-size: 12px; color: #475569;">Tipo</label>
            <select id="loteFormTipo" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <option value="lote">Lote</option>
              <option value="corral">Corral</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormFirma" style="font-weight: 700; font-size: 12px; color: #475569;">Firma Social</label>
            <input type="text" id="loteFormFirma" placeholder="Ej: Daedaz S.A." list="datalistFirmas" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
            <datalist id="datalistFirmas"></datalist>
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormCliente" style="font-weight: 700; font-size: 12px; color: #475569;">Establecimiento / Campo</label>
            <input type="text" id="loteFormCliente" placeholder="Ej: Don Martín" list="datalistCampos" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
            <datalist id="datalistCampos"></datalist>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormProvincia" style="font-weight: 700; font-size: 12px; color: #475569;">Provincia</label>
            <input type="text" id="loteFormProvincia" placeholder="Ej: Buenos Aires" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormPartido" style="font-weight: 700; font-size: 12px; color: #475569;">Partido / Localidad</label>
            <input type="text" id="loteFormPartido" placeholder="Ej: Tandil" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormLat" style="font-weight: 700; font-size: 12px; color: #475569;">Latitud</label>
            <input type="number" id="loteFormLat" step="0.000001" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormLng" style="font-weight: 700; font-size: 12px; color: #475569;">Longitud</label>
            <input type="number" id="loteFormLng" step="0.000001" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('loteEditModal').close()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: transparent; cursor: pointer;">Cancelar</button>
          <button type="submit" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--color-primary); color: white; cursor: pointer; font-weight: 700;">Guardar</button>
        </div>
      </form>
    </dialog>'''

new_modal = '''    <dialog id="loteEditModal" style="border: none; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 480px; background: white; color: #0f172a;">
      <h3 id="loteModalTitle" style="margin-top: 0; font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 18px; margin-bottom: 16px;">Editar Lote</h3>
      <form id="loteEditForm" style="display: flex; flex-direction: column; gap: 16px;">
        <input type="hidden" id="loteFormId" />
        
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="loteFormNombre" style="font-weight: 700; font-size: 12px; color: #475569;">Nombre del Lote / Corral</label>
          <input type="text" id="loteFormNombre" required style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormHectareas" style="font-weight: 700; font-size: 12px; color: #475569;">Hectáreas</label>
            <input type="number" id="loteFormHectareas" step="0.01" min="0" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormTipo" style="font-weight: 700; font-size: 12px; color: #475569;">Tipo</label>
            <select id="loteFormTipo" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <option value="lote">Lote</option>
              <option value="corral">Corral</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="loteFormCampoId" style="font-weight: 700; font-size: 12px; color: #475569;">Establecimiento / Campo</label>
          <select id="loteFormCampoId" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <option value="">-- Sin Campo --</option>
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormLat" style="font-weight: 700; font-size: 12px; color: #475569;">Latitud</label>
            <input type="number" id="loteFormLat" step="0.000001" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormLng" style="font-weight: 700; font-size: 12px; color: #475569;">Longitud</label>
            <input type="number" id="loteFormLng" step="0.000001" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
          </div>
        </div>

        <!-- Hidden datalists for backwards compat -->
        <datalist id="datalistFirmas"></datalist>
        <datalist id="datalistCampos"></datalist>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('loteEditModal').close()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: transparent; cursor: pointer;">Cancelar</button>
          <button type="submit" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--color-primary); color: white; cursor: pointer; font-weight: 700;">Guardar</button>
        </div>
      </form>
    </dialog>'''

count = html.count(old_modal)
print(f"Found {count} occurrences of old_modal")
if count == 1:
    html = html.replace(old_modal, new_modal)
    print("Replaced old modal with new modal")
else:
    print("WARNING: Could not find exact old_modal match! Skipping replacement.")

# ===== 3. Remove the duplicate catastro JS block at the bottom =====
# Find the block that starts with "window.catastroData" and ends before </body>
# The block to remove starts at the <script> tag just before "window.catastroData"
# and goes to </script>\n</body>

# The bottom block starts after the last renderCatastroTab closure
bottom_script_pattern = r'\n<script>\nwindow\.catastroData = \{ firmas: \[\], campos: \[\], lotes: \[\] \};.*?</script>\n</body>'
matches = list(re.finditer(bottom_script_pattern, html, flags=re.DOTALL))
print(f"Found {len(matches)} bottom catastro script blocks")
if len(matches) >= 1:
    # Remove all of them and put back </body>
    for m in reversed(matches):
        html = html[:m.start()] + "\n</body>" + html[m.end():]
    print(f"Removed {len(matches)} duplicate bottom script block(s)")

# ===== 4. Update the old JS functions to use new form fields and API =====
# Replace old abrirModalLote to use loteFormCampoId
old_abrir = '''      window.abrirModalLote = function(lote = null) {
        const modal = $("loteEditModal");
        if (!modal) return;

        // Populate Datalists for Autocomplete to prevent typos
        const lotes = uiState.lastData?.lotes || [];
        const firmas = [...new Set(lotes.map(l => l.firma).filter(Boolean))].sort();
        const campos = [...new Set(lotes.map(l => l.cliente).filter(Boolean))].sort();

        $("datalistFirmas").innerHTML = firmas.map(f => `<option value="${esc(f)}">`).join("");
        $("datalistCampos").innerHTML = campos.map(c => `<option value="${esc(c)}">`).join("");

        if (lote && lote.id) {
          $("loteModalTitle").textContent = "Editar Lote / Corral";
          $("loteFormId").value = lote.id;
          $("loteFormNombre").value = lote.nombre || "";
          $("loteFormHectareas").value = lote.hectareas || "";
          $("loteFormTipo").value = lote.tipo || "lote";
          $("loteFormFirma").value = lote.firma || "";
          $("loteFormCliente").value = lote.cliente || "";
          $("loteFormProvincia").value = lote.provincia || "";
          $("loteFormPartido").value = lote.partido || "";
          $("loteFormLat").value = lote.lat != null ? lote.lat : "";
          $("loteFormLng").value = lote.lng != null ? lote.lng : "";
        } else {
          $("loteModalTitle").textContent = "Nuevo Lote / Corral";
          $("loteFormId").value = "";
          $("loteFormNombre").value = "";
          $("loteFormHectareas").value = "";
          $("loteFormTipo").value = "lote";
          $("loteFormFirma").value = "";
          $("loteFormCliente").value = "";
          $("loteFormProvincia").value = uiState.lastData?.usuario?.provincia || "";
          $("loteFormPartido").value = uiState.lastData?.usuario?.partido || "";
          $("loteFormLat").value = lote?.lat != null ? lote.lat : "";
          $("loteFormLng").value = lote?.lng != null ? lote.lng : "";
        }

        modal.showModal();
      };'''

new_abrir = '''      window.abrirModalLote = function(lote = null) {
        const modal = $("loteEditModal");
        if (!modal) return;

        // Populate Campo select from catastro data
        const campoSelect = $("loteFormCampoId");
        if (campoSelect && window.catastroData) {
          campoSelect.innerHTML = '<option value="">-- Sin Campo --</option>' +
            (window.catastroData.campos || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
        }

        if (lote && lote.id) {
          $("loteModalTitle").textContent = "Editar Lote / Corral";
          $("loteFormId").value = lote.id;
          $("loteFormNombre").value = lote.nombre || "";
          $("loteFormHectareas").value = lote.hectareas || "";
          $("loteFormTipo").value = lote.tipo || "lote";
          if (campoSelect) campoSelect.value = lote.campo_id || "";
          $("loteFormLat").value = lote.lat != null ? lote.lat : "";
          $("loteFormLng").value = lote.lng != null ? lote.lng : "";
        } else {
          $("loteModalTitle").textContent = "Nuevo Lote / Corral";
          $("loteFormId").value = "";
          $("loteFormNombre").value = "";
          $("loteFormHectareas").value = "";
          $("loteFormTipo").value = "lote";
          if (campoSelect) campoSelect.value = "";
          $("loteFormLat").value = lote?.lat != null ? lote.lat : "";
          $("loteFormLng").value = lote?.lng != null ? lote.lng : "";
        }

        modal.showModal();
      };'''

if html.count(old_abrir) == 1:
    html = html.replace(old_abrir, new_abrir)
    print("Replaced abrirModalLote function")
else:
    print(f"WARNING: abrirModalLote found {html.count(old_abrir)} times")

# ===== 5. Replace guardarLoteDesdeForm to use new API =====
old_guardar = '''      async function guardarLoteDesdeForm() {
        const id = $("loteFormId").value;
        const body = {
          nombre: $("loteFormNombre").value.trim(),
          hectareas: $("loteFormHectareas").value !== "" ? Number($("loteFormHectareas").value) : null,
          tipo: $("loteFormTipo").value,
          firma: $("loteFormFirma").value.trim() || null,
          cliente: $("loteFormCliente").value.trim() || null,
          provincia: $("loteFormProvincia").value.trim() || null,
          partido: $("loteFormPartido").value.trim() || null,
          lat: $("loteFormLat").value !== "" ? Number($("loteFormLat").value) : null,
          lng: $("loteFormLng").value !== "" ? Number($("loteFormLng").value) : null
        };

        const url = id ? `/api/inventario/lotes/${id}` : "/api/inventario/lotes";
        const method = id ? "PUT" : "POST";

        try {
          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const d = await res.json();
          if (!d.ok) return alert(d.error || "No se pudo guardar el lote.");

          $("loteEditModal").close();
          await cargar(); // Reload user data
          if (catastroMap) {
            initCatastroMap();
          }
        } catch (err) {
          alert("Error de conexión: " + err.message);
        }
      }'''

new_guardar = '''      async function guardarLoteDesdeForm() {
        const id = $("loteFormId").value;
        const body = {
          nombre: $("loteFormNombre").value.trim(),
          hectareas: $("loteFormHectareas").value !== "" ? Number($("loteFormHectareas").value) : null,
          campo_id: $("loteFormCampoId")?.value || null,
          lat: $("loteFormLat").value !== "" ? Number($("loteFormLat").value) : null,
          lng: $("loteFormLng").value !== "" ? Number($("loteFormLng").value) : null
        };

        // Include pending polygon geojson if drawn
        if (window._pendingLoteGeoJSON) {
          body.geojson = window._pendingLoteGeoJSON;
          window._pendingLoteGeoJSON = null;
        }

        const url = id ? `/api/catastro/lotes/${id}` : "/api/catastro/lotes";
        const method = id ? "PUT" : "POST";

        try {
          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const d = await res.json();
          if (!d.ok) return alert(d.error || "No se pudo guardar el lote.");

          $("loteEditModal").close();
          await cargar(); // Reload user data
          if (window.catastroData) await loadCatastroData();
          if (catastroMap) {
            initCatastroMap();
          }
        } catch (err) {
          alert("Error de conexión: " + err.message);
        }
      }'''

if html.count(old_guardar) == 1:
    html = html.replace(old_guardar, new_guardar)
    print("Replaced guardarLoteDesdeForm function")
else:
    print(f"WARNING: guardarLoteDesdeForm found {html.count(old_guardar)} times")

# ===== 6. Replace the catastro map init to support polygons and fix dblclick =====
old_map_init = '''      // 🗺️ Leaflet Map initialization and rendering
      function initCatastroMap() {
        const u = uiState.lastData?.usuario;
        const lat = u?.lat != null ? Number(u.lat) : -34.6037;
        const lng = u?.lng != null ? Number(u.lng) : -58.3816;
        const lotes = uiState.lastData?.lotes || [];

        const mapContainer = document.getElementById("catastroMap");
        if (!mapContainer) return;

        if (catastroMap) {
          try {
            catastroMap.remove();
          } catch (err) {
            console.warn("Error removing old catastro map:", err);
          }
        }

        catastroMap = L.map('catastroMap').setView([lat, lng], 14);
        catMapMarkers = {};

        // Satellite base layer
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; World Imagery'
        }).addTo(catastroMap);

        const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        });

        L.control.layers({
          "Satelital": satelliteLayer,
          "Calles": streetLayer
        }).addTo(catastroMap);

        // Marker for user's main location
        L.marker([lat, lng]).addTo(catastroMap)
          .bindPopup(`<b>Establecimiento Principal</b><br>${u?.partido || 'Pergamino'}, ${u?.provincia || 'Buenos Aires'}`);

        // Draw circles/markers for all georeferenced lots
        const colors = ['#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
        let bounds = L.latLngBounds([lat, lng]);
        let hasGeoreferenced = false;

        lotes.forEach((l, idx) => {
          if (l.lat != null && l.lng != null) {
            const lotLat = Number(l.lat);
            const lotLng = Number(l.lng);
            bounds.extend([lotLat, lotLng]);
            hasGeoreferenced = true;

            const color = colors[idx % colors.length];

            // 1. Draw a circle representing the approximate lot area (100 meters default radius)
            const circle = L.circle([lotLat, lotLng], {
              color,
              fillColor: color,
              fillOpacity: 0.25,
              radius: Math.sqrt((Number(l.hectareas) || 10) * 10000 / Math.PI) || 120 // area proportional to hectares
            }).addTo(catastroMap);

            // 2. Draw a draggable marker in the center
            const marker = L.marker([lotLat, lotLng], {
              draggable: true
            }).addTo(catastroMap);

            marker.bindPopup(`
              <div style="font-family:'Outfit',sans-serif; color:#0f172a;">
                <b>Lote: ${esc(l.nombre)}</b><br />
                Has: ${l.hectareas || 'N/D'}<br />
                Establecimiento: ${esc(l.cliente || 'Sin asignar')}<br />
                Firma: ${esc(l.firma || 'Sin asignar')}<br />
                <button type="button" class="btn-primary" onclick='abrirModalLote(${JSON.stringify(l).replace(/'/g, "\\\\'")})' style="padding:4px 8px; font-size:10px; margin-top:8px; border-radius:4px;">Editar</button>
              </div>
            `);

            // Save reference to marker
            catMapMarkers[l.id] = { marker, circle };

            // Handle marker drag end to update coordinates
            marker.on("dragend", async (e) => {
              const newPos = marker.getLatLng();
              if (confirm(`¿Mover el lote "${l.nombre}" a las nuevas coordenadas [${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}]?`)) {
                await actualizarUbicacionLote(l.id, newPos.lat, newPos.lng);
              } else {
                // reset position
                marker.setLatLng([lotLat, lotLng]);
                circle.setLatLng([lotLat, lotLng]);
              }
            });

            // Keep circle in sync during dragging
            marker.on("drag", (e) => {
              circle.setLatLng(marker.getLatLng());
            });
          }
        });

        // Map Click to georeference a lot or add a new one
        catastroMap.on("click", async (e) => {
          if (mapModeActive && mapModeLoteId) {
            const clickedLat = e.latlng.lat;
            const clickedLng = e.latlng.lng;
            desactivarModoMapa();
            await actualizarUbicacionLote(mapModeLoteId, clickedLat, clickedLng);
          }
        });

        // Double click to add a new lot at this point
        catastroMap.on("dblclick", (e) => {
          // Leaflet double click zoom is disabled during double click add
          L.DomEvent.stopPropagation(e);
          const clickedLat = e.latlng.lat;
          const clickedLng = e.latlng.lng;
          
          // Show form with prefilled coords
          abrirModalLote({
            lat: clickedLat,
            lng: clickedLng,
            provincia: u?.provincia || "",
            partido: u?.partido || ""
          });
        });

        // Adjust view to fit all lots
        if (hasGeoreferenced) {
          catastroMap.fitBounds(bounds, { padding: [50, 50] });
        }
      }'''

new_map_init = '''      // 🗺️ Leaflet Map initialization and rendering (with polygon/draw support)
      let drawnItems = null;
      let drawControl = null;

      function initCatastroMap() {
        const u = uiState.lastData?.usuario;
        const lat = u?.lat != null ? Number(u.lat) : -34.6037;
        const lng = u?.lng != null ? Number(u.lng) : -58.3816;
        const lotes = uiState.lastData?.lotes || [];

        const mapContainer = document.getElementById("catastroMap");
        if (!mapContainer) return;

        if (catastroMap) {
          try {
            catastroMap.remove();
          } catch (err) {
            console.warn("Error removing old catastro map:", err);
          }
        }

        catastroMap = L.map('catastroMap', { doubleClickZoom: false }).setView([lat, lng], 14);
        catMapMarkers = {};

        // Satellite base layer
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; World Imagery'
        }).addTo(catastroMap);

        const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        });

        L.control.layers({
          "Satelital": satelliteLayer,
          "Calles": streetLayer
        }).addTo(catastroMap);

        // Marker for user's main location
        L.marker([lat, lng]).addTo(catastroMap)
          .bindPopup(`<b>Establecimiento Principal</b><br>${u?.partido || 'Pergamino'}, ${u?.provincia || 'Buenos Aires'}`);

        // ── Leaflet.Draw: polygon drawing ──
        drawnItems = new L.FeatureGroup();
        catastroMap.addLayer(drawnItems);

        drawControl = new L.Control.Draw({
          position: 'topright',
          draw: {
            polygon: {
              allowIntersection: false,
              showArea: true,
              shapeOptions: { color: '#10b981', weight: 2, fillOpacity: 0.15 }
            },
            polyline: false,
            rectangle: {
              shapeOptions: { color: '#6366f1', weight: 2, fillOpacity: 0.15 }
            },
            circle: false,
            circlemarker: false,
            marker: false
          },
          edit: { featureGroup: drawnItems }
        });
        catastroMap.addControl(drawControl);

        // When a polygon/rectangle is drawn, open the Lote form with geojson
        catastroMap.on(L.Draw.Event.CREATED, function(e) {
          const layer = e.layer;
          drawnItems.addLayer(layer);

          const geojson = layer.toGeoJSON();
          window._pendingLoteGeoJSON = geojson.geometry;

          // Calculate centroid for lat/lng
          const bounds = layer.getBounds();
          const center = bounds.getCenter();

          // Calculate area in hectares (approximate)
          let areaHa = null;
          if (layer.getLatLngs) {
            const latlngs = layer.getLatLngs()[0] || layer.getLatLngs();
            if (latlngs.length >= 3) {
              // Shoelace formula on projected coords
              let area = 0;
              for (let i = 0; i < latlngs.length; i++) {
                const j = (i + 1) % latlngs.length;
                const p1 = catastroMap.project(latlngs[i], 14);
                const p2 = catastroMap.project(latlngs[j], 14);
                area += p1.x * p2.y - p2.x * p1.y;
              }
              // Convert pixel area to meters at zoom 14
              const metersPerPixel = 40075016.686 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, 14 + 8);
              const areaM2 = Math.abs(area / 2) * metersPerPixel * metersPerPixel;
              areaHa = Math.round(areaM2 / 10000 * 100) / 100;
            }
          }

          abrirModalLote({
            lat: center.lat,
            lng: center.lng,
            hectareas: areaHa
          });
        });

        // Draw existing lot polygons/circles for all georeferenced lots
        const colors = ['#10b981', '#6366f1', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
        let fitBounds = L.latLngBounds([lat, lng]);
        let hasGeoreferenced = false;

        lotes.forEach((l, idx) => {
          if (l.lat != null && l.lng != null) {
            const lotLat = Number(l.lat);
            const lotLng = Number(l.lng);
            fitBounds.extend([lotLat, lotLng]);
            hasGeoreferenced = true;

            const color = colors[idx % colors.length];

            // If the lote has a saved polygon (geojson), draw it
            if (l.geojson) {
              try {
                const geoLayer = L.geoJSON(l.geojson, {
                  style: { color, fillColor: color, fillOpacity: 0.2, weight: 2 }
                }).addTo(catastroMap);

                geoLayer.eachLayer(gl => {
                  if (gl.getBounds) fitBounds.extend(gl.getBounds());
                  gl.bindPopup(`
                    <div style="font-family:'Outfit',sans-serif; color:#0f172a;">
                      <b>Lote: ${esc(l.nombre)}</b><br />
                      Has: ${l.hectareas || 'N/D'}<br />
                      <button type="button" class="btn-primary" onclick='abrirModalLote(${JSON.stringify(l).replace(/'/g, "\\\\'")})' style="padding:4px 8px; font-size:10px; margin-top:8px; border-radius:4px;">Editar</button>
                    </div>
                  `);
                });
              } catch(e) {
                console.warn("Error rendering geojson for lote", l.id, e);
              }
            } else {
              // Fallback: draw a circle proportional to hectares
              const circle = L.circle([lotLat, lotLng], {
                color,
                fillColor: color,
                fillOpacity: 0.25,
                radius: Math.sqrt((Number(l.hectareas) || 10) * 10000 / Math.PI) || 120
              }).addTo(catastroMap);

              catMapMarkers[l.id] = { circle };
            }

            // Always add a draggable marker at the center
            const marker = L.marker([lotLat, lotLng], {
              draggable: true
            }).addTo(catastroMap);

            marker.bindPopup(`
              <div style="font-family:'Outfit',sans-serif; color:#0f172a;">
                <b>Lote: ${esc(l.nombre)}</b><br />
                Has: ${l.hectareas || 'N/D'}<br />
                <button type="button" class="btn-primary" onclick='abrirModalLote(${JSON.stringify(l).replace(/'/g, "\\\\'")})' style="padding:4px 8px; font-size:10px; margin-top:8px; border-radius:4px;">Editar</button>
              </div>
            `);

            if (catMapMarkers[l.id]) {
              catMapMarkers[l.id].marker = marker;
            } else {
              catMapMarkers[l.id] = { marker };
            }

            marker.on("dragend", async (e) => {
              const newPos = marker.getLatLng();
              if (confirm(`¿Mover el lote "${l.nombre}" a [${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}]?`)) {
                await actualizarUbicacionLote(l.id, newPos.lat, newPos.lng);
              } else {
                marker.setLatLng([lotLat, lotLng]);
                if (catMapMarkers[l.id]?.circle) catMapMarkers[l.id].circle.setLatLng([lotLat, lotLng]);
              }
            });

            marker.on("drag", (e) => {
              if (catMapMarkers[l.id]?.circle) catMapMarkers[l.id].circle.setLatLng(marker.getLatLng());
            });
          }
        });

        // Map Click to georeference a lot in "locate mode"
        catastroMap.on("click", async (e) => {
          if (mapModeActive && mapModeLoteId) {
            const clickedLat = e.latlng.lat;
            const clickedLng = e.latlng.lng;
            desactivarModoMapa();
            await actualizarUbicacionLote(mapModeLoteId, clickedLat, clickedLng);
          }
        });

        // Double click to add a new lot at this point
        catastroMap.on("dblclick", (e) => {
          if (mapModeActive) return;
          const clickedLat = e.latlng.lat;
          const clickedLng = e.latlng.lng;
          abrirModalLote({
            lat: clickedLat,
            lng: clickedLng
          });
        });

        // Adjust view to fit all lots
        if (hasGeoreferenced) {
          catastroMap.fitBounds(fitBounds, { padding: [50, 50] });
        }
      }'''

if html.count(old_map_init) == 1:
    html = html.replace(old_map_init, new_map_init)
    print("Replaced initCatastroMap with polygon support")
else:
    print(f"WARNING: initCatastroMap found {html.count(old_map_init)} times")

# ===== 7. Update actualizarUbicacionLote to use catastro API =====
old_actualizar = '''      async function actualizarUbicacionLote(loteId, lat, lng) {
        try {
          const l = uiState.lastData?.lotes?.find(x => x.id === loteId);
          if (!l) return;
          const body = {
            ...l,
            lat: Number(lat),
            lng: Number(lng)
          };
          const res = await fetch(`/api/inventario/lotes/${loteId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const d = await res.json();
          if (!d.ok) return alert(d.error || "No se pudo actualizar la coordenadas.");
          await cargar();
          initCatastroMap();
        } catch (err) {
          alert("Error de conexión al mover lote: " + err.message);
        }
      }'''

new_actualizar = '''      async function actualizarUbicacionLote(loteId, lat, lng) {
        try {
          const l = uiState.lastData?.lotes?.find(x => x.id === loteId);
          if (!l) return;
          const body = {
            nombre: l.nombre,
            campo_id: l.campo_id || null,
            hectareas: l.hectareas || null,
            lat: Number(lat),
            lng: Number(lng)
          };
          const res = await fetch(`/api/catastro/lotes/${loteId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const d = await res.json();
          if (!d.ok) return alert(d.error || "No se pudo actualizar las coordenadas.");
          await cargar();
          if (window.catastroData) await loadCatastroData();
          initCatastroMap();
        } catch (err) {
          alert("Error de conexión al mover lote: " + err.message);
        }
      }'''

if html.count(old_actualizar) == 1:
    html = html.replace(old_actualizar, new_actualizar)
    print("Replaced actualizarUbicacionLote function")
else:
    print(f"WARNING: actualizarUbicacionLote found {html.count(old_actualizar)} times")

# ===== 8. Add catastroData init and loadCatastroData function before </body> =====
catastro_init_js = '''
<script>
window.catastroData = { firmas: [], campos: [], lotes: [] };
window._pendingLoteGeoJSON = null;

async function loadCatastroData() {
  try {
    const [resF, resC, resL] = await Promise.all([
      fetch("/api/catastro/firmas").then(r => r.json()),
      fetch("/api/catastro/campos").then(r => r.json()),
      fetch("/api/catastro/lotes").then(r => r.json())
    ]);
    if (resF.ok) window.catastroData.firmas = resF.data;
    if (resC.ok) window.catastroData.campos = resC.data;
    if (resL.ok) window.catastroData.lotes = resL.data;
    renderCatastroUI();
  } catch(e) {
    console.error("Error loading catastro:", e);
  }
}

function renderCatastroUI() {
  const { firmas, campos, lotes } = window.catastroData;

  const tbodyFirmas = document.getElementById("catFirmasTableBody");
  if(tbodyFirmas) {
    tbodyFirmas.innerHTML = firmas.length === 0 
      ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">Sin firmas. Usá "+ Nueva Firma" para crear.</td></tr>' 
      : firmas.map(f => {
        const camposCount = campos.filter(c => c.firma_id === f.id).length;
        return `<tr>
          <td><b>${f.nombre}</b></td>
          <td>${camposCount} campo(s)</td>
          <td style="text-align:right;">
            <button class="btn-secondary" onclick="abrirModalFirma(${f.id})" style="padding:4px 8px;font-size:11px;margin-right:4px;">Editar</button>
            <button class="btn-danger" onclick="eliminarFirma(${f.id})" style="padding:4px 8px;font-size:11px;background-color:var(--color-danger);color:white;border:none;border-radius:6px;cursor:pointer;">Borrar</button>
          </td>
        </tr>`;
      }).join("");
  }

  const tbodyCampos = document.getElementById("catCamposTableBody");
  if(tbodyCampos) {
    tbodyCampos.innerHTML = campos.length === 0 
      ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:16px;">Sin campos. Usá "+ Nuevo Campo" para crear.</td></tr>' 
      : campos.map(c => {
        const firmaName = firmas.find(f => f.id === c.firma_id)?.nombre || '—';
        return `<tr>
          <td><b>${c.nombre}</b><br/><small>${c.ciudad || ''} ${c.provincia || ''}</small></td>
          <td>Firma: ${firmaName}</td>
          <td style="text-align:right;">
            <button class="btn-secondary" onclick="abrirModalCampo(${c.id})" style="padding:4px 8px;font-size:11px;margin-right:4px;">Editar</button>
            <button class="btn-danger" onclick="eliminarCampo(${c.id})" style="padding:4px 8px;font-size:11px;background-color:var(--color-danger);color:white;border:none;border-radius:6px;cursor:pointer;">Borrar</button>
          </td>
        </tr>`;
      }).join("");
  }
}

function populateSelectCampos() {
  const select = document.getElementById("loteFormCampoId");
  if(select) {
    select.innerHTML = '<option value="">-- Sin Campo --</option>' +
      window.catastroData.campos.map(c => `<option value="${c.id}">${c.nombre}</option>`).join("");
  }
}
function populateSelectFirmas() {
  const select = document.getElementById("campoFormFirma");
  if(select) {
    select.innerHTML = '<option value="">-- Sin Firma --</option>' +
      window.catastroData.firmas.map(f => `<option value="${f.id}">${f.nombre}</option>`).join("");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Firma modal
  document.getElementById("btnCatNuevaFirma")?.addEventListener("click", () => abrirModalFirma());
  document.getElementById("firmaEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("firmaFormId").value;
    const body = { nombre: document.getElementById("firmaFormNombre").value };
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/catastro/firmas/${id}` : "/api/catastro/firmas";
    await fetch(url, { method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body) });
    document.getElementById("firmaEditModal").close();
    loadCatastroData();
  });

  // Campo modal
  document.getElementById("btnCatNuevoCampo")?.addEventListener("click", () => abrirModalCampo());
  document.getElementById("campoEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("campoFormId").value;
    const body = {
      nombre: document.getElementById("campoFormNombre").value,
      firma_id: document.getElementById("campoFormFirma").value || null,
      ciudad: document.getElementById("campoFormCiudad").value,
      provincia: document.getElementById("campoFormProvincia").value
    };
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/catastro/campos/${id}` : "/api/catastro/campos";
    await fetch(url, { method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body) });
    document.getElementById("campoEditModal").close();
    loadCatastroData();
  });

  // Tab switch hooks
  const tabs = document.querySelectorAll(".tab-link");
  tabs.forEach(t => {
    t.addEventListener("click", () => {
      if (t.dataset.tab === "catastro") loadCatastroData();
    });
  });
});

window.abrirModalFirma = function(id = null) {
  const firma = id ? window.catastroData.firmas.find(f => f.id === id) : null;
  document.getElementById("firmaModalTitle").textContent = firma ? "Editar Firma" : "Nueva Firma";
  document.getElementById("firmaFormId").value = firma ? firma.id : "";
  document.getElementById("firmaFormNombre").value = firma ? firma.nombre : "";
  document.getElementById("firmaEditModal").showModal();
};

window.abrirModalCampo = function(id = null) {
  populateSelectFirmas();
  const campo = id ? window.catastroData.campos.find(c => c.id === id) : null;
  document.getElementById("campoModalTitle").textContent = campo ? "Editar Campo" : "Nuevo Campo";
  document.getElementById("campoFormId").value = campo ? campo.id : "";
  document.getElementById("campoFormNombre").value = campo ? campo.nombre : "";
  document.getElementById("campoFormFirma").value = campo ? (campo.firma_id || "") : "";
  document.getElementById("campoFormCiudad").value = campo ? (campo.ciudad || "") : "";
  document.getElementById("campoFormProvincia").value = campo ? (campo.provincia || "") : "";
  document.getElementById("campoEditModal").showModal();
};

window.eliminarFirma = async function(id) {
  if(confirm("¿Seguro que deseas eliminar esta firma?")) {
    await fetch(`/api/catastro/firmas/${id}`, { method: "DELETE" });
    loadCatastroData();
  }
};
window.eliminarCampo = async function(id) {
  if(confirm("¿Seguro que deseas eliminar este campo?")) {
    await fetch(`/api/catastro/campos/${id}`, { method: "DELETE" });
    loadCatastroData();
  }
};
</script>
</body>'''

html = html.replace("</body>", catastro_init_js, 1)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(html)

print("\n✅ All fixes applied successfully!")
