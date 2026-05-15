import express = require("express");
import { META_SEPARATOR } from "../config";
import { createAnswerStream, parseModelResponse, searchWeb } from "../services/chat-service";
import {
  appendConversationTurn,
  buildPromptContent,
  createConversationTurn,
  saveAssistantMessage,
} from "../services/conversation-service";
import type { AttachmentItem } from "../types";

export const chatRouter = express.Router();

chatRouter.post("/vectra_ask", async (req, res) => {
  const userId = typeof req.body.userId === "string" ? req.body.userId : "";
  const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
  const attachments = parseAttachments(req.body.attachments);

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    const conversationId = userId ? (await createConversationTurn(userId, query, attachments)).conversationId : null;
    await streamAssistantResponse({
      res,
      conversationId,
      query: buildPromptContent(query, attachments),
      history: [],
    });
  } catch (error) {
    console.error("Could not handle request", error);
    return res.status(500).json({ error: "Could not complete request" });
  }
});

chatRouter.post("/vectra_ask/followup", async (req, res) => {
  const userId = typeof req.body.userId === "string" ? req.body.userId : "";
  const query = typeof req.body.query === "string" ? req.body.query.trim() : "";
  const conversationId = typeof req.body.conversationId === "string" ? req.body.conversationId : "";
  const attachments = parseAttachments(req.body.attachments);
  const requestHistory = Array.isArray(req.body.history) ? req.body.history : [];
  const history = Array.isArray(req.body.history)
    ? requestHistory
        .filter(
          (item: unknown): item is { role: string; content: string } =>
            !!item &&
            typeof item === "object" &&
            typeof (item as { role?: unknown }).role === "string" &&
            typeof (item as { content?: unknown }).content === "string",
        )
        .map((item: { role: string; content: string }) => ({
          role: item.role,
          content: item.content,
        }))
    : [];

  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  try {
    if (!userId || !conversationId) {
      await streamAssistantResponse({
        res,
        conversationId: null,
        query: buildPromptContent(query, attachments),
        history,
      });
      return;
    }

    const turn = await appendConversationTurn(conversationId, userId, query, attachments);
    await streamAssistantResponse({
      res,
      conversationId: turn.conversationId,
      query: buildPromptContent(query, attachments),
      history: turn.history,
    });
  } catch (error) {
    console.error("Could not handle follow-up", error);
    return res.status(500).json({ error: "Could not complete request" });
  }
});

async function streamAssistantResponse({
  res,
  conversationId,
  query,
  history,
}: {
  res: express.Response;
  conversationId: string | null;
  query: string;
  history: Array<{ role: string; content: string }>;
}) {
  const webSearch = await searchWeb(query);
  const result = createAnswerStream(query, webSearch.rawResults, history);

  res.header("Cache-Control", "no-cache");
  res.header("Content-Type", "text/event-stream");

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    res.write(chunk);
  }

  const parsed = parseModelResponse(fullText);
  const assistantMessage = conversationId
    ? await saveAssistantMessage({
        conversationId,
        answer: parsed.answer,
        sources: webSearch.sources,
        images: webSearch.images,
        followUps: parsed.followUps,
      })
    : null;

  res.write(
    `${META_SEPARATOR}${JSON.stringify({
      conversationId,
      messageId: assistantMessage?.id ?? null,
      answer: parsed.answer,
      followUps: parsed.followUps,
      sources: webSearch.sources,
      images: webSearch.images,
    })}`,
  );
  res.end();
}

function parseAttachments(input: unknown): AttachmentItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(
      (item: unknown): item is AttachmentItem =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { type?: unknown }).type === "string" &&
        typeof (item as { size?: unknown }).size === "number" &&
        ((item as { kind?: unknown }).kind === "image" || (item as { kind?: unknown }).kind === "file") &&
        (typeof (item as { url?: unknown }).url === "string" || typeof (item as { url?: unknown }).url === "undefined"),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      size: item.size,
      url: item.url,
      kind: item.kind,
    }));
}
