"use strict";

const winston = require("winston");
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

const maskWhatsapp = (whatsapp = "") => {
  const digits = String(whatsapp || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4).padStart(4, "*");
};

const logConsulta = ({ level = "info", whatsapp = "", route = "", message = "" } = {}) => {
  const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
  fn({
    service: "consultas",
    whatsapp: maskWhatsapp(whatsapp),
    route: String(route || ""),
    message: String(message || ""),
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  logConsulta,
  maskWhatsapp,
};
