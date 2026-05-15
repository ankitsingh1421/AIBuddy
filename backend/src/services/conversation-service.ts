import { prisma } from "../../db";
import { createConversationSlug } from "../lib/slug";
import type { AttachmentItem, ImageItem, SourceItem } from "../types";

export async function ensureUserExists(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

export async function listConversations(userId: string) {
  await ensureUserExists(userId);

  return prisma.conversation.findMany({
    where: {
      userId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      title: true,
      slug: true,
      updatedAt: true,
    },
  });
}

export async function getConversationDetail(conversationId: string, userId: string) {
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
    throw new Error("Conversation not found");
  }

  return {
    id: conversation.id,
    title: conversation.title || "Untitled",
    slug: conversation.slug,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: parseJsonArray<SourceItem>(message.sources),
      images: message.role === "ASSISTANT" ? parseJsonArray<ImageItem>(message.images) : [],
      attachments: message.role === "USER" ? parseJsonArray<AttachmentItem>(message.images) : [],
      followUps: parseJsonArray<string>(message.followUps),
      createdAt: message.createdAt,
    })),
  };
}

export async function createConversationTurn(userId: string, query: string, attachments: AttachmentItem[] = []) {
  await ensureUserExists(userId);

  const conversation = await prisma.conversation.create({
    data: {
      userId,
      title: createConversationTitle(query),
      slug: createConversationSlug(query),
      messages: {
        create: {
          role: "USER",
          content: query,
          images: attachments,
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

  return {
    conversationId: conversation.id,
    history: [] as Array<{ role: "USER" | "ASSISTANT"; content: string }>,
    userMessageId: conversation.messages[0]?.id ?? null,
  };
}

export async function appendConversationTurn(
  conversationId: string,
  userId: string,
  query: string,
  attachments: AttachmentItem[] = [],
) {
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
    throw new Error("Conversation not found");
  }

  const history = conversation.messages.map((message) => ({
    role: message.role,
    content:
      message.role === "USER"
        ? buildPromptContent(message.content, parseJsonArray<AttachmentItem>(message.images))
        : message.content,
  }));

  const userMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: query,
      images: attachments,
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

  return {
    conversationId,
    history,
    userMessageId: userMessage.id,
  };
}

export async function saveAssistantMessage(input: {
  conversationId: string;
  answer: string;
  sources: SourceItem[];
  images: ImageItem[];
  followUps: string[];
}) {
  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: "ASSISTANT",
      content: input.answer,
      sources: input.sources,
      images: input.images,
      followUps: input.followUps,
    },
  });

  await prisma.conversation.update({
    where: {
      id: input.conversationId,
    },
    data: {
      updatedAt: new Date(),
    },
  });

  return message;
}

function createConversationTitle(query: string) {
  const trimmed = query.trim().replace(/\s+/g, " ");
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

function parseJsonArray<T>(value: unknown) {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function buildPromptContent(query: string, attachments: AttachmentItem[] = []) {
  if (!attachments.length) {
    return query;
  }

  const attachmentLines = attachments.map((item) => `- ${item.name} (${item.kind})`);
  return `${query}\n\nAttached items:\n${attachmentLines.join("\n")}`;
}
