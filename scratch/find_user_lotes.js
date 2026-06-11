require("dotenv").config();
const { query } = require("../src/config/database");

async function check() {
  try {
    const resUser = await query(
      `SELECT id, nombre, whatsapp, whatsapp_real, whatsapp_jid FROM usuarios WHERE whatsapp LIKE '%2281%' OR whatsapp_real LIKE '%2281%'`
    );
    console.log("USERS MATCHING 2281:", resUser.rows);
    if (resUser.rows.length > 0) {
      for (const user of resUser.rows) {
        const resLotes = await query(
          `SELECT id, nombre, cliente, firma, hectareas, cultivo FROM lotes WHERE usuario_id = $1`,
          [user.id]
        );
        console.log(`LOTES FOR USER ${user.id} (${user.nombre}):`, resLotes.rows);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
