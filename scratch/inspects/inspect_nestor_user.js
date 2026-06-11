"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function main() {
  const res = await query("SELECT * FROM usuarios WHERE id = 538");
  console.log(JSON.stringify(res.rows[0], null, 2));
  process.exit(0);
}

main().catch(console.error);
