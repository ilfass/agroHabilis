require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { testConnection } = require("./config/database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "AgroHabilis",
    version: "1.0.0",
  });
});

const startServer = async () => {
  try {
    await testConnection();
    app.listen(PORT, () => {
      console.log(`AgroHabilis escuchando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("No se pudo iniciar la aplicacion:", error.message);
    process.exit(1);
  }
};

startServer();
