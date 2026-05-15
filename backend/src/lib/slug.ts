export function createConversationSlug(input: string) {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-|-$/g, "");

  const suffix = Math.random().toString(36).slice(2, 8);
  return `${normalized || "conversation"}-${suffix}`;
}
