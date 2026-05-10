#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  inferirComandoNatural,
  resolverComandoAlias,
  sugerirComandoPorTexto,
} = require("../../src/services/whatsapp_intents");
const consultaTpl = require("../../src/templates/consulta");

const CASES_PATH = path.join(__dirname, "qa-whatsapp-cases.json");
const REPORT_MD_PATH = path.join(__dirname, "..", "..", "docs", "operacion", "qa-whatsapp-report.md");
const REPORT_JSON_PATH = path.join(__dirname, "qa-whatsapp-last.json");

const readCases = () => {
  const raw = fs.readFileSync(CASES_PATH, "utf8");
  const data = JSON.parse(raw);
  return Array.isArray(data.cases) ? data.cases : [];
};

const writeCases = (cases) => {
  fs.writeFileSync(CASES_PATH, JSON.stringify({ cases }, null, 2));
};

const sanitize = (txt) => {
  if (consultaTpl?.__qa?.limpiarSalidaIA) {
    return consultaTpl.__qa.limpiarSalidaIA(txt);
  }
  return String(txt || "");
};

const nowIso = () => new Date().toISOString();

const runCase = (c) => {
  if (c.kind === "alias") {
    const out = resolverComandoAlias(String(c.input || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase());
    const ok = out === c.expectedAlias;
    return { ok, got: out, expected: c.expectedAlias };
  }
  if (c.kind === "intent") {
    const out = inferirComandoNatural(c.input || "");
    const ok = out === c.expectedIntent;
    return { ok, got: out, expected: c.expectedIntent };
  }
  if (c.kind === "sanitize") {
    const out = sanitize(c.input || "");
    const forbid = Array.isArray(c.forbid) ? c.forbid : [];
    const hits = forbid.filter((f) => out.includes(f));
    const ok = hits.length === 0;
    return { ok, got: out, expected: `sin: ${forbid.join(", ")}` };
  }
  if (c.kind === "suggestion") {
    const out = sugerirComandoPorTexto(c.input || "");
    if (c.expectedNull) {
      const ok = !out;
      return { ok, got: out || "", expected: "sin sugerencia" };
    }
    const must = String(c.expectedContains || "");
    const ok = must ? String(out || "").includes(must) : Boolean(out);
    return { ok, got: out || "", expected: must || "con sugerencia" };
  }
  return { ok: false, got: "kind no soportado", expected: c.kind };
};

const renderMd = (results) => {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  const lines = [
    "# QA WhatsApp Report",
    "",
    `- Fecha: ${nowIso()}`,
    `- Total: ${total}`,
    `- PASS: ${passed}`,
    `- FAIL: ${failed}`,
    "",
    "## Detalle",
    "",
  ];
  for (const r of results) {
    lines.push(`### ${r.ok ? "✅" : "❌"} ${r.id} - ${r.title}`);
    lines.push(`- kind: \`${r.kind}\``);
    lines.push(`- input: \`${String(r.input || "").replace(/\n/g, "\\n")}\``);
    lines.push(`- expected: \`${String(r.expected || "").replace(/\n/g, "\\n")}\``);
    lines.push(`- got: \`${String(r.got || "").replace(/\n/g, "\\n")}\``);
    lines.push("");
  }
  return lines.join("\n");
};

const cmdRun = () => {
  const cases = readCases();
  const results = cases.map((c) => {
    const out = runCase(c);
    return {
      id: c.id,
      title: c.title || c.id,
      kind: c.kind,
      input: c.input,
      expected: out.expected,
      got: out.got,
      ok: out.ok,
    };
  });
  const md = renderMd(results);
  fs.writeFileSync(REPORT_MD_PATH, md);
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify({ generatedAt: nowIso(), results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`QA WhatsApp: ${results.length - failed}/${results.length} PASS`);
  console.log(`Reporte: ${REPORT_MD_PATH}`);
  if (failed > 0) process.exit(1);
};

const parseArg = (name, fallback = "") => {
  const key = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(key));
  return hit ? hit.slice(key.length) : fallback;
};

const cmdAdd = () => {
  const kind = parseArg("kind", "intent");
  const title = parseArg("title", "").trim();
  const input = parseArg("input", "").trim();
  if (!title || !input) {
        console.error("Uso: node scripts/qa/qa-whatsapp.js add --kind=intent|alias|sanitize|suggestion --title=\"...\" --input=\"...\" [--expected=...] [--forbid=a,b] [--expectedNull=true]");
    process.exit(1);
  }
  const id = `${Date.now()}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
  const item = { id, kind, title, input };
  if (kind === "intent") item.expectedIntent = parseArg("expected", "");
  if (kind === "alias") item.expectedAlias = parseArg("expected", "");
  if (kind === "sanitize") item.forbid = parseArg("forbid", "").split(",").map((x) => x.trim()).filter(Boolean);
  if (kind === "suggestion") {
    item.expectedContains = parseArg("expected", "");
    item.expectedNull = parseArg("expectedNull", "false") === "true";
  }
  const cases = readCases();
  cases.push(item);
  writeCases(cases);
  console.log(`Caso agregado: ${id}`);
  console.log(`Total casos: ${cases.length}`);
};

const action = process.argv[2] || "run";
if (action === "run") cmdRun();
else if (action === "add") cmdAdd();
else {
  console.error(`Acción no soportada: ${action}`);
  process.exit(1);
}
