export type AuthProvider = "google" | "github";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  provider: "GOOGLE" | "GITHUB";
};

export type SourceItem = {
  title: string;
  url: string;
  content: string;
  favicon?: string;
  publishedDate?: string;
};

export type ImageItem = {
  url: string;
  description?: string;
};

export type AttachmentItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  kind: "image" | "file";
};

export type ConversationStreamMetadata = {
  conversationId: string | null;
  messageId: number | null;
  answer: string;
  followUps: string[];
  sources: SourceItem[];
  images: ImageItem[];
};
