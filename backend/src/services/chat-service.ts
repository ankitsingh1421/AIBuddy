import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { tavily } from "@tavily/core";
import { buildPrompt, SYSTEM_PROMPT } from "../../prompt";
import type { ImageItem, SourceItem } from "../types";

const tavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY || "",
});

export async function searchWeb(query: string) {
  const webSearchResponse = await tavilyClient.search(query, {
    searchDepth: "advanced",
    includeImages: true,
    includeImageDescriptions: true,
    includeFavicon: true,
  });
  const typedResponse = webSearchResponse as typeof webSearchResponse & {
    images?: Array<{
      url: string;
      description?: string;
    }>;
  };

  const results = webSearchResponse.results || [];
  const sources = results.map((result) => ({
    title: result.title || getHostname(result.url || ""),
    url: result.url || "",
    content: result.content || "",
    favicon: result.favicon || undefined,
    publishedDate: result.publishedDate || undefined,
  })) satisfies SourceItem[];
  const images = (typedResponse.images || []).map((image) => ({
    url: image.url,
    description: image.description,
  })) satisfies ImageItem[];

  return {
    rawResults: results,
    sources,
    images,
  };
}

export function createAnswerStream(query: string, webResults: unknown, history: Array<{ role: string; content: string }>) {
  const prompt = buildPrompt({
    query,
    webResults,
    history,
  });

  return streamText({
    model: groq("llama-3.1-8b-instant"),
    prompt,
    system: SYSTEM_PROMPT,
  });
}

export function parseModelResponse(text: string) {
  const answerMatch = text.match(/<ANSWER>([\s\S]*?)<\/ANSWER>/i);
  const followUpMatches = [...text.matchAll(/<QUESTION>([\s\S]*?)<\/QUESTION>/gi)];

  const answer = (answerMatch?.[1] || text)
    .replace(/<FOLLOW_UP>[\s\S]*$/i, "")
    .trim();

  const followUps = followUpMatches
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean)
    .slice(0, 3);

  return {
    answer,
    followUps,
  };
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "Untitled source";
  }
}
