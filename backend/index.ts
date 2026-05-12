import express = require("express");
import cors = require("cors");
import bodyParser = require("body-parser");
import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { tavily } from "@tavily/core";
import { z } from "zod";
import { prisma } from "./db";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt";

type AuthProvider = "google" | "github";

type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  provider: "GOOGLE" | "GITHUB";
};

type SearchResult = {
  title: string;
  url: string;
  content: string;
  favicon?: string;
  publishedDate?: string;
};

type SearchImage = {
  url: string;
  description?: string;
};

const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY || "",
});

const app = express();
const PORT = Number(process.env.PORT || 5000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const META_SEPARATOR = "\n__VECTRA_META__";

const requestSchema = z.object({
  userId: z.string().min(1),
  query: z.string().min(1),
});

const followUpSchema = requestSchema.extend({
  conversationId: z.string().min(1),
});

app.use(
  cors({
    origin: FRONTEND_URL,
  }),
);
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Hello from singh server !!");
});

app.get("/auth/:provider", async (req, res) => {
  const provider = req.params.provider as AuthProvider;
  const redirect = typeof req.query.redirect === "string" ? req.query.redirect : `${FRONTEND_URL}/dashboard`;

  if (provider !== "google" && provider !== "github") {
    return res.redirect(`${FRONTEND_URL}/auth?error=invalid_provider`);
  }

  try {
    const authUrl = buildAuthorizationUrl(provider, redirect);
    return res.redirect(authUrl);
  } catch {
    return res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

app.get("/auth/:provider/callback", async (req, res) => {
  const provider = req.params.provider as AuthProvider;
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const redirect = typeof req.query.state === "string" ? decodeURIComponent(req.query.state) : `${FRONTEND_URL}/dashboard`;

  if (!code || (provider !== "google" && provider !== "github")) {
    return res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }

  try {
    const authenticatedUser = await authenticateWithProvider(provider, code);
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set("user", encodeURIComponent(JSON.stringify(authenticatedUser)));
    return res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("OAuth callback failed", error);
    if (isDatabaseConnectionError(error)) {
      const redirectUrl = new URL(redirect);
      redirectUrl.searchParams.set("authError", "db_unavailable");
      return res.redirect(redirectUrl.toString());
    }

    return res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

app.get("/conversations", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : "";

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      userId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
  });

  return res.json(
    conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title || conversation.messages[0]?.content || "New chat",
      slug: conversation.slug,
      updatedAt: conversation.updatedAt,
    })),
  );
});

app.get("/conversation/:conversationId", async (req, res) => {
  const conversationId = req.params.conversationId;
  const userId = typeof req.query.userId === "string" ? req.query.userId : "";

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  return res.json(serializeConversation(conversation));
});

app.post("/vectra_ask", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const conversation = await prisma.conversation.create({
      data: {
        userId: parsed.data.userId,
        title: createConversationTitle(parsed.data.query),
        slug: createSlug(parsed.data.query),
        messages: {
          create: {
            role: "USER",
            content: parsed.data.query,
          },
        },
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    await streamConversationResponse({
      res,
      conversationId: conversation.id,
      query: parsed.data.query,
      history: [],
    });
  } catch (error) {
    console.error("vectra_ask failed", error);
    return sendJsonErrorIfPossible(res, "Could not create conversation");
  }
});

app.post("/vectra_ask/followup", async (req, res) => {
  const parsed = followUpSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: parsed.data.conversationId,
        userId: parsed.data.userId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: parsed.data.query,
      },
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    await streamConversationResponse({
      res,
      conversationId: conversation.id,
      query: parsed.data.query,
      history: conversation.messages,
    });
  } catch (error) {
    console.error("vectra_ask/followup failed", error);
    return sendJsonErrorIfPossible(res, "Could not continue conversation");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

async function streamConversationResponse({
  res,
  conversationId,
  query,
  history,
}: {
  res: express.Response;
  conversationId: string;
  query: string;
  history: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
}) {
  const webSearchResponse = await tavilyClient.search(query, {
    searchDepth: "advanced",
    maxResults: 8,
    includeImages: true,
    includeImageDescriptions: true,
    includeFavicon: true,
  });

  const sources = webSearchResponse.results.map((result) => ({
    title: result.title,
    url: result.url,
    content: result.content,
    favicon: result.favicon,
    publishedDate: result.publishedDate,
  }));

  const images = (webSearchResponse.images || []).slice(0, 12).map((image) => ({
    url: image.url,
    description: image.description,
  }));

  const prompt = buildPrompt({
    query,
    history,
    webSearchResults: sources,
  });

  const result = streamText({
    model: groq("llama-3.1-8b-instant"),
    prompt,
    system: SYSTEM_PROMPT,
  });

  res.header("Cache-Control", "no-cache");
  res.header("Content-Type", "text/plain; charset=utf-8");
  res.header("Transfer-Encoding", "chunked");

  let fullResponse = "";
  for await (const textPart of result.textStream) {
    fullResponse += textPart;
    res.write(textPart);
  }

  const parsed = parseAssistantResponse(fullResponse);
  const assistantMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: parsed.answer,
      sources,
      images,
      followUps: parsed.followUps,
    },
  });

  await prisma.conversation.update({
    where: {
      id: conversationId,
    },
    data: {
      updatedAt: new Date(),
    },
  });

  res.write(
    `${META_SEPARATOR}${JSON.stringify({
      conversationId,
      messageId: assistantMessage.id,
      answer: parsed.answer,
      followUps: parsed.followUps,
      sources,
      images,
    })}`,
  );
  res.end();
}

function buildPrompt({
  query,
  history,
  webSearchResults,
}: {
  query: string;
  history: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  webSearchResults: SearchResult[];
}) {
  const historyText = history.length
    ? history.map((message) => `${message.role}: ${message.content}`).join("\n")
    : "No previous conversation.";

  return `${PROMPT_TEMPLATE
    .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResults))
    .replace("{{USER_QUERY}}", query)}

## CONVERSATION_HISTORY
${historyText}`;
}

function parseAssistantResponse(rawText: string) {
  const answer = extractTagContent(rawText, "ANSWER") || rawText.trim();
  const followUpBlock = extractTagContent(rawText, "FOLLOW_UP");
  const followUps = followUpBlock
    ? Array.from(followUpBlock.matchAll(/<QUESTION>([\s\S]*?)<\/QUESTION>/g))
        .map((match) => match[1]?.trim() || "")
        .filter(Boolean)
    : [];

  return {
    answer: answer.trim(),
    followUps: followUps.slice(0, 5),
  };
}

function extractTagContent(input: string, tagName: string) {
  const match = input.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return match?.[1]?.trim() || "";
}

function serializeConversation(conversation: {
  id: string;
  title: string | null;
  slug: string;
  updatedAt: Date;
  messages: Array<{
    id: number;
    role: "USER" | "ASSISTANT";
    content: string;
    sources: unknown;
    images: unknown;
    followUps: unknown;
    createdAt: Date;
  }>;
}) {
  return {
    id: conversation.id,
    title: conversation.title || "New chat",
    slug: conversation.slug,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: Array.isArray(message.sources) ? message.sources : [],
      images: Array.isArray(message.images) ? message.images : [],
      followUps: Array.isArray(message.followUps) ? message.followUps : [],
      createdAt: message.createdAt,
    })),
  };
}

function createConversationTitle(query: string) {
  return query.trim().slice(0, 72);
}

function createSlug(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${normalized || "chat"}-${crypto.randomUUID().slice(0, 8)}`;
}

function sendJsonErrorIfPossible(res: express.Response, message: string) {
  if (!res.headersSent) {
    return res.status(500).json({ error: message });
  }

  res.end();
}

function buildAuthorizationUrl(provider: AuthProvider, redirect: string) {
  if (provider === "google") {
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
    googleUrl.searchParams.set("redirect_uri", `http://localhost:${PORT}/auth/google/callback`);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile");
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("prompt", "consent");
    googleUrl.searchParams.set("state", encodeURIComponent(redirect));
    return googleUrl.toString();
  }

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID || "");
  githubUrl.searchParams.set("redirect_uri", `http://localhost:${PORT}/auth/github/callback`);
  githubUrl.searchParams.set("scope", "read:user user:email");
  githubUrl.searchParams.set("state", encodeURIComponent(redirect));
  return githubUrl.toString();
}

async function authenticateWithProvider(provider: AuthProvider, code: string): Promise<AuthenticatedUser> {
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
        redirect_uri: `http://localhost:${PORT}/auth/google/callback`,
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
      redirect_uri: `http://localhost:${PORT}/auth/github/callback`,
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
      provider: input.provider,
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
    provider: input.provider,
  };
}

function isDatabaseConnectionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorRecord = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  return (
    errorRecord.code === "ECONNREFUSED" ||
    errorRecord.cause?.code === "ECONNREFUSED" ||
    errorRecord.message?.includes("ECONNREFUSED") === true ||
    errorRecord.cause?.message?.includes("ECONNREFUSED") === true
  );
}
