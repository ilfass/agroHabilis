import re

file_path = "/home/fabian/Documentos/Agro.habilispro/frontend/public/cliente.html"

with open(file_path, "r", encoding="utf-8") as f:
    html = f.read()

# 1. Add Firmas + button
firmas_target = '<h4 style="margin: 0; font-size: 14px;">Firmas Sociales Declaradas</h4>'
firmas_repl = '''<div style="display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin: 0; font-size: 14px;">Firmas Sociales Declaradas</h4>
                    <button type="button" class="btn-primary" id="btnCatNuevaFirma" style="padding: 6px 12px; font-size: 12px;">+ Nueva Firma</button>
                  </div>'''
html = html.replace(firmas_target, firmas_repl)

# 2. Add Campos + button
campos_target = '<h4 style="margin: 0; font-size: 14px;">Campos / Establecimientos</h4>'
campos_repl = '''<div style="display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="margin: 0; font-size: 14px;">Campos / Establecimientos</h4>
                    <button type="button" class="btn-primary" id="btnCatNuevoCampo" style="padding: 6px 12px; font-size: 12px;">+ Nuevo Campo</button>
                  </div>'''
html = html.replace(campos_target, campos_repl)

# 3. Inject new dialogs
dialogs = '''
    <!-- Modales de Catastro: Firma y Campo -->
    <dialog id="firmaEditModal" style="border: none; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 400px; background: white; color: #0f172a;">
      <h3 id="firmaModalTitle" style="margin-top: 0; margin-bottom: 20px; font-size: 18px; font-weight: 800;">Nueva Firma</h3>
      <form id="firmaEditForm" style="display: flex; flex-direction: column; gap: 16px;">
        <input type="hidden" id="firmaFormId" />
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="firmaFormNombre" style="font-weight: 700; font-size: 12px; color: #475569;">Nombre de la Firma / Empresa</label>
          <input type="text" id="firmaFormNombre" required placeholder="Ej: Agro Sur S.A." style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('firmaEditModal').close()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: transparent; cursor: pointer;">Cancelar</button>
          <button type="submit" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--color-primary); color: white; cursor: pointer; font-weight: 700;">Guardar</button>
        </div>
      </form>
    </dialog>

    <dialog id="campoEditModal" style="border: none; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 400px; background: white; color: #0f172a;">
      <h3 id="campoModalTitle" style="margin-top: 0; margin-bottom: 20px; font-size: 18px; font-weight: 800;">Nuevo Campo</h3>
      <form id="campoEditForm" style="display: flex; flex-direction: column; gap: 16px;">
        <input type="hidden" id="campoFormId" />
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="campoFormNombre" style="font-weight: 700; font-size: 12px; color: #475569;">Nombre del Establecimiento</label>
          <input type="text" id="campoFormNombre" required placeholder="Ej: La Esperanza" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="campoFormFirma" style="font-weight: 700; font-size: 12px; color: #475569;">Firma Asociada</label>
          <select id="campoFormFirma" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <option value="">-- Sin Firma --</option>
          </select>
        </div>
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="campoFormCiudad" style="font-weight: 700; font-size: 12px; color: #475569;">Ciudad</label>
          <input type="text" id="campoFormCiudad" placeholder="Ej: Tandil" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>
        <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
          <label for="campoFormProvincia" style="font-weight: 700; font-size: 12px; color: #475569;">Provincia</label>
          <input type="text" id="campoFormProvincia" placeholder="Ej: Buenos Aires" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('campoEditModal').close()" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: transparent; cursor: pointer;">Cancelar</button>
          <button type="submit" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--color-primary); color: white; cursor: pointer; font-weight: 700;">Guardar</button>
        </div>
      </form>
    </dialog>
'''
html = html.replace("</dialog>\n\n    <!-- Chat Widget Flotante -->", "</dialog>\n\n" + dialogs + "\n    <!-- Chat Widget Flotante -->")

# 4. Modify Lote modal to use Campo select instead of input text for Firma and Cliente
lote_modal_target = '''<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormFirma" style="font-weight: 700; font-size: 12px; color: #475569;">Firma (Razón Social)</label>
            <input type="text" id="loteFormFirma" list="datalistFirmas" placeholder="Ej: Agro Sur S.A." style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
            <datalist id="datalistFirmas"></datalist>
          </div>
          <div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormCliente" style="font-weight: 700; font-size: 12px; color: #475569;">Establecimiento / Campo</label>
            <input type="text" id="loteFormCliente" list="datalistCampos" placeholder="Ej: La Esperanza" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;" />
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
        </div>'''

lote_modal_repl = '''<div class="form-group" style="display: flex; flex-direction: column; gap: 6px;">
            <label for="loteFormCampoId" style="font-weight: 700; font-size: 12px; color: #475569;">Establecimiento / Campo</label>
            <select id="loteFormCampoId" style="width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <option value="">-- Sin Campo --</option>
            </select>
          </div>'''
html = html.replace(lote_modal_target, lote_modal_repl)

# We also need to add JS to handle the new API and Modals.
# I'll append a <script> block at the end of the body.
new_js = """
<script>
window.catastroData = { firmas: [], campos: [], lotes: [] };

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
  
  // Render Firmas
  const tbodyFirmas = document.getElementById("catFirmasTableBody");
  if(tbodyFirmas) {
    tbodyFirmas.innerHTML = firmas.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Sin firmas</td></tr>' : firmas.map(f => `
      <tr>
        <td><b>${f.nombre}</b></td>
        <td>${campos.filter(c => c.firma_id === f.id).length} campos</td>
        <td style="text-align:right;">
          <button class="btn-secondary" onclick="abrirModalFirma(${f.id})" style="padding:4px 8px;font-size:11px;">Editar</button>
          <button class="btn-danger" onclick="eliminarFirma(${f.id})" style="padding:4px 8px;font-size:11px;">Borrar</button>
        </td>
      </tr>
    `).join("");
  }
  
  // Render Campos
  const tbodyCampos = document.getElementById("catCamposTableBody");
  if(tbodyCampos) {
    tbodyCampos.innerHTML = campos.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Sin campos</td></tr>' : campos.map(c => {
      const firmaName = firmas.find(f => f.id === c.firma_id)?.nombre || '-';
      return `
      <tr>
        <td><b>${c.nombre}</b> <br/><small>${c.ciudad || ''} ${c.provincia || ''}</small></td>
        <td>Firma: ${firmaName}</td>
        <td style="text-align:right;">
          <button class="btn-secondary" onclick="abrirModalCampo(${c.id})" style="padding:4px 8px;font-size:11px;">Editar</button>
          <button class="btn-danger" onclick="eliminarCampo(${c.id})" style="padding:4px 8px;font-size:11px;">Borrar</button>
        </td>
      </tr>
      `;
    }).join("");
  }
  
  // Render Lotes (replace the old uiState.lastData logic)
  const tbodyLotes = document.getElementById("catLotesTableBody");
  if(tbodyLotes) {
    tbodyLotes.innerHTML = lotes.length === 0 ? '<tr><td colspan="4" style="text-align:center;">Sin lotes</td></tr>' : lotes.map(l => {
      const campo = campos.find(c => c.id === l.campo_id);
      const campoName = campo ? campo.nombre : (l.cliente || '-');
      const hasCoords = l.lat != null && l.lng != null ? '✅' : '❌';
      return `
      <tr>
        <td><b>${l.nombre}</b> <br/><small>${l.hectareas || '?'} ha</small></td>
        <td>${campoName}</td>
        <td>${hasCoords}</td>
        <td style="text-align:right;">
          <button class="btn-secondary" onclick="window.abrirModalLoteCatastro(${l.id})" style="padding:4px 8px;font-size:11px;">Editar</button>
          <button class="btn-danger" onclick="eliminarLoteCatastro(${l.id})" style="padding:4px 8px;font-size:11px;">Borrar</button>
        </td>
      </tr>
      `;
    }).join("");
  }
  
  // Refresh Map markers
  if (window.renderCatastroMap) {
    window.renderCatastroMap(lotes);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnCatNuevaFirma")?.addEventListener("click", () => abrirModalFirma());
  document.getElementById("btnCatNuevoCampo")?.addEventListener("click", () => abrirModalCampo());
  
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
  
  // Update Lote Edit logic
  document.getElementById("btnCatNuevoLote")?.addEventListener("click", () => window.abrirModalLoteCatastro());
  
  const formLote = document.getElementById("loteEditForm");
  if(formLote) {
      // remove old listeners
      const newFormLote = formLote.cloneNode(true);
      formLote.parentNode.replaceChild(newFormLote, formLote);
      newFormLote.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("loteFormId").value;
        const body = { 
          nombre: document.getElementById("loteFormNombre").value,
          campo_id: document.getElementById("loteFormCampoId").value || null,
          hectareas: document.getElementById("loteFormHectareas").value || null,
          lat: document.getElementById("loteFormLat").value || null,
          lng: document.getElementById("loteFormLng").value || null
        };
        const method = id ? "PUT" : "POST";
        const url = id ? `/api/catastro/lotes/${id}` : "/api/catastro/lotes";
        await fetch(url, { method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body) });
        document.getElementById("loteEditModal").close();
        loadCatastroData();
      });
  }
});

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
  document.getElementById("campoFormFirma").value = campo ? campo.firma_id : "";
  document.getElementById("campoFormCiudad").value = campo ? campo.ciudad : "";
  document.getElementById("campoFormProvincia").value = campo ? campo.provincia : "";
  document.getElementById("campoEditModal").showModal();
};

window.abrirModalLoteCatastro = function(id = null) {
  populateSelectCampos();
  const lote = id ? window.catastroData.lotes.find(l => l.id === id) : null;
  document.getElementById("loteModalTitle").textContent = lote ? "Editar Lote" : "Nuevo Lote";
  document.getElementById("loteFormId").value = lote ? lote.id : "";
  document.getElementById("loteFormNombre").value = lote ? lote.nombre : "";
  document.getElementById("loteFormHectareas").value = lote ? lote.hectareas : "";
  document.getElementById("loteFormCampoId").value = lote ? lote.campo_id : "";
  document.getElementById("loteFormLat").value = lote?.lat != null ? lote.lat : "";
  document.getElementById("loteFormLng").value = lote?.lng != null ? lote.lng : "";
  document.getElementById("loteEditModal").showModal();
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
window.eliminarLoteCatastro = async function(id) {
  if(confirm("¿Seguro que deseas eliminar este lote?")) {
    await fetch(`/api/catastro/lotes/${id}`, { method: "DELETE" });
    loadCatastroData();
  }
};

// Hook into the tab switch to load data
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab-link");
  tabs.forEach(t => {
    t.addEventListener("click", () => {
      if (t.dataset.tab === "catastro") {
        loadCatastroData();
      }
    });
  });
});
</script>
</body>
"""
html = html.replace("</body>", new_js)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(html)
print("Updated cliente.html")
