import express = require("express");
import { getConversationDetail, listConversations } from "../services/conversation-service";

export const conversationRouter = express.Router();

conversationRouter.get("/conversations", async (req, res) => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : "";

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    const conversations = await listConversations(userId);
    return res.json(
      conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title || "Untitled",
        slug: conversation.slug,
        updatedAt: conversation.updatedAt,
      })),
    );
  } catch (error) {
    console.error("Could not load conversations", error);
    return res.status(500).json({ error: "Could not load conversations" });
  }
});

conversationRouter.get("/conversation/:conversationId", async (req, res) => {
  const conversationId = req.params.conversationId;
  const userId = typeof req.query.userId === "string" ? req.query.userId : "";

  if (!conversationId || !userId) {
    return res.status(400).json({ error: "conversationId and userId are required" });
  }

  try {
    const conversation = await getConversationDetail(conversationId, userId);
    return res.json(conversation);
  } catch (error) {
    console.error("Could not load conversation", error);
    return res.status(404).json({ error: "Conversation not found" });
  }
});
