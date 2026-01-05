// OpenAI embeddings helpers

import type OpenAI from "openai";

export function embeddingDimForModel(model: string): number {
  if (model === "text-embedding-3-large") return 3072;
  return 1536;
}

export async function embedQuery(client: OpenAI, model: string, text: string): Promise<number[]> {
  const resp = await client.embeddings.create({
    model,
    input: text,
    encoding_format: "float",
  });
  return resp.data[0]?.embedding as number[];
}
