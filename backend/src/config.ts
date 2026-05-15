import "dotenv/config";

export const PORT = Number(process.env.PORT || 5000);
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
export const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
export const META_SEPARATOR = "\n__VECTRA_META__";
