import { prisma } from "../../db";
import { API_BASE_URL } from "../config";
import type { AuthenticatedUser, AuthProvider } from "../types";

export function buildAuthorizationUrl(provider: AuthProvider, redirect: string) {
  if (provider === "google") {
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    googleUrl.searchParams.set("redirect_uri", `${API_BASE_URL}/auth/google/callback`);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("prompt", "consent");
    googleUrl.searchParams.set("state", encodeURIComponent(redirect));
    return googleUrl.toString();
  }

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID || "");
  githubUrl.searchParams.set("redirect_uri", `${API_BASE_URL}/auth/github/callback`);
  githubUrl.searchParams.set("scope", "read:user user:email");
  githubUrl.searchParams.set("state", encodeURIComponent(redirect));
  return githubUrl.toString();
}

export async function authenticateWithProvider(
  provider: AuthProvider,
  code: string,
): Promise<AuthenticatedUser> {
  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: `${API_BASE_URL}/auth/google/callback`,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error("Google token exchange failed");
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error("Google profile fetch failed");
    }

    const profile = (await profileResponse.json()) as {
      email: string;
      name: string;
      picture?: string;
    };

    return persistUser({
      email: profile.email,
      name: profile.name,
      image: profile.picture || null,
      provider: "GOOGLE",
    });
  }

  const githubTokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GITHUB_CLIENT_ID || "",
      client_secret: process.env.GITHUB_CLIENT_SECRET || "",
      redirect_uri: `${API_BASE_URL}/auth/github/callback`,
    }).toString(),
  });

  if (!githubTokenResponse.ok) {
    throw new Error("GitHub token exchange failed");
  }

  const githubTokenData = (await githubTokenResponse.json()) as { access_token: string };
  const [githubProfileResponse, githubEmailResponse] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubTokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "vectra-app",
      },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${githubTokenData.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "vectra-app",
      },
    }),
  ]);

  if (!githubProfileResponse.ok || !githubEmailResponse.ok) {
    throw new Error("GitHub profile fetch failed");
  }

  const githubProfile = (await githubProfileResponse.json()) as {
    name?: string;
    login: string;
    avatar_url?: string;
  };

  const githubEmails = (await githubEmailResponse.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;

  const primaryEmail =
    githubEmails.find((item) => item.primary && item.verified)?.email ||
    githubEmails.find((item) => item.verified)?.email ||
    githubEmails[0]?.email;

  if (!primaryEmail) {
    throw new Error("GitHub email not found");
  }

  return persistUser({
    email: primaryEmail,
    name: githubProfile.name || githubProfile.login,
    image: githubProfile.avatar_url || null,
    provider: "GITHUB",
  });
}

async function persistUser(input: Omit<AuthenticatedUser, "id">): Promise<AuthenticatedUser> {
  const existingUser = await prisma.user.findFirst({
    where: {
      email: input.email,
      provider: input.provider,
    },
  });

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: {
        id: existingUser.id,
      },
      data: {
        name: input.name,
        image: input.image,
      },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      image: updatedUser.image,
      provider: updatedUser.provider,
    };
  }

  const createdUser = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      image: input.image,
      provider: input.provider,
    },
  });

  return {
    id: createdUser.id,
    email: createdUser.email,
    name: createdUser.name,
    image: createdUser.image,
    provider: createdUser.provider,
  };
}

export function isDatabaseUnavailableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /connect|database|postgres|prisma/i.test(message);
}
