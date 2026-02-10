import type { IncomingMessage } from "node:http";

import type { HttpConfig } from "./httpServerConfig.js";

export function baseUrlForRequest(req: IncomingMessage, config: HttpConfig): URL {
  const reqUrl = req.url ?? "/";
  return new URL(reqUrl, `http://${config.host}:${config.port}`);
}

export function extractBearerToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }

  const headerToken = req.headers["x-ailss-token"];
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();

  const queryToken = url.searchParams.get("token");
  if (queryToken && queryToken.trim()) return queryToken.trim();

  return null;
}

export async function readJsonBody(req: IncomingMessage, limitBytes: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

export function isInitializeRequestMessage(body: unknown): boolean {
  if (!body) return false;
  if (Array.isArray(body)) return body.some(isInitializeRequestMessage);
  if (typeof body !== "object") return false;

  const method = (body as { method?: unknown }).method;
  return method === "initialize";
}

export function getSingleHeaderValue(
  req: IncomingMessage,
  name: string,
): string | null | "multiple" {
  const key = name.toLowerCase();

  const distinct = req.headersDistinct?.[key];
  if (Array.isArray(distinct)) {
    if (distinct.length === 1) return distinct[0] ?? null;
    if (distinct.length > 1) return "multiple";
  }

  const value = req.headers[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return "multiple";
  return null;
}
