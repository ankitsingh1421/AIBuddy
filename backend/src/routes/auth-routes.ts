import express = require("express");
import { FRONTEND_URL } from "../config";
import { authenticateWithProvider, buildAuthorizationUrl, isDatabaseUnavailableError } from "../services/auth-service";
import type { AuthProvider } from "../types";

export const authRouter = express.Router();

authRouter.get("/:provider", async (req, res) => {
  const provider = req.params.provider as AuthProvider;
  const redirect =
    typeof req.query.redirect === "string" ? req.query.redirect : `${FRONTEND_URL}/dashboard`;

  if (provider !== "google" && provider !== "github") {
    return res.redirect(`${FRONTEND_URL}/dashboard?authError=invalid_provider`);
  }

  try {
    const authUrl = buildAuthorizationUrl(provider, redirect);
    return res.redirect(authUrl);
  } catch {
    return res.redirect(`${FRONTEND_URL}/dashboard?authError=oauth_failed`);
  }
});

authRouter.get("/:provider/callback", async (req, res) => {
  const provider = req.params.provider as AuthProvider;
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const redirect =
    typeof req.query.state === "string" ? decodeURIComponent(req.query.state) : `${FRONTEND_URL}/dashboard`;

  if (!code || (provider !== "google" && provider !== "github")) {
    return res.redirect(`${FRONTEND_URL}/dashboard?authError=oauth_failed`);
  }

  try {
    const authenticatedUser = await authenticateWithProvider(provider, code);
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("user", encodeURIComponent(JSON.stringify(authenticatedUser)));
    return res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("OAuth callback failed", error);

    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set(
      "authError",
      isDatabaseUnavailableError(error) ? "db_unavailable" : "oauth_failed",
    );
    return res.redirect(redirectUrl.toString());
  }
});
