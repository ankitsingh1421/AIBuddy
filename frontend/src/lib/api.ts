const DEFAULT_API_BASE_URL = "https://vectra-backend-ayv7.onrender.com";

export const API_BASE_URL =
  globalThis.process?.env?.BUN_PUBLIC_API_BASE_URL ||
  DEFAULT_API_BASE_URL;
