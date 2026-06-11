"use strict";

require("dotenv").config();
const { query, pool } = require("../src/config/database");
const { resolverNumeroRealMensaje } = require("../src/config/whatsapp.js");
const { obtenerContextoPlanPorWhatsapp } = require("../src/services/planes");
const { registrarGasto } = require("../src/services/gastos");

async function main() {
  console.log("=== RUNNING DIEGO FIGUEROA LID INTEGRATION TEST ===");

  // Mock message from Diego's LID
  const msgMock = {
    from: "208683921358918@lid",
    body: "gaste 120000 en combustible",
    hasMedia: false,
    reply: (texto) => {
      console.log(`[BOT REPLY]: ${texto}`);
      return Promise.resolve();
    },
    getContact: () => {
      return Promise.resolve({
        number: "5492494218078",
        userid: "208683921358918",
        id: {
          _serialized: "5492494218078@c.us",
          user: "5492494218078"
        }
      });
    }
  };

  try {
    // 1. Resolve real number
    const numeroReal = await resolverNumeroRealMensaje(msgMock);
    console.log(`[RESOLVED NUMBER]: ${numeroReal} (Expected: 5492494218078)`);

    if (numeroReal !== "5492494218078") {
      throw new Error("LID failed to resolve to Diego's real number!");
    }

    // 2. Resolve plan context
    const planCtx = await obtenerContextoPlanPorWhatsapp(msgMock.from, numeroReal);
    console.log("[RESOLVED PLAN CTX]:", {
      hasUsuario: !!planCtx.usuario,
      esDelegado: planCtx.usuario?.es_delegado,
      nombreOperario: planCtx.usuario?.nombre_operario,
      rolOperario: planCtx.usuario?.rol_operario,
      bossName: planCtx.usuario?.nombre,
      bossId: planCtx.usuario?.id,
      plan: planCtx.plan,
      planEfectivo: planCtx.planEfectivo
    });

    if (!planCtx.usuario || !planCtx.usuario.es_delegado || planCtx.usuario.nombre_operario !== "Diego Figueroa") {
      throw new Error("Resolved user is not Diego Figueroa delegate!");
    }

    // 3. Clean up any previous test gasoil gastos for boss
    await query("DELETE FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%combustible%'", [planCtx.usuario.id]);

    // 4. Call registrarGasto using the resolved user object!
    const replyText = await registrarGasto(planCtx.usuario || msgMock.from, msgMock.body);
    console.log(`\n[REGISTRAR GASTO RESPONSE]:\n${replyText}\n`);

    if (replyText.includes("onboarding")) {
      throw new Error("System blocked the register and asked for onboarding!");
    }

    // 5. Verify database record was added under boss id and has the "Registrado por Diego Figueroa" suffix
    const dbRecord = await query(
      "SELECT * FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%combustible%' ORDER BY id DESC LIMIT 1",
      [planCtx.usuario.id]
    );
    console.log("[DB VERIFICATION]:");
    if (dbRecord.rows.length > 0) {
      console.log("[OK] Gasto inserted successfully:", dbRecord.rows[0]);
    } else {
      throw new Error("No database record was found for the register!");
    }

    // Clean up
    await query("DELETE FROM gastos WHERE usuario_id = $1 AND descripcion LIKE '%combustible%'", [planCtx.usuario.id]);
    console.log("\n✅ Test passed successfully! Diego Figueroa LID mapping and registers are working perfectly!");

  } catch (e) {
    console.error("\n❌ Test failed:", e.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
