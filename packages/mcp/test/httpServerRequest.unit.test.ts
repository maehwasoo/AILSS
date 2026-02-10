import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import {
  baseUrlForRequest,
  extractBearerToken,
  getSingleHeaderValue,
  isInitializeRequestMessage,
  readJsonBody,
} from "../src/httpServerRequest.js";

function createRequest(options?: {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  headersDistinct?: Record<string, string[]>;
}): IncomingMessage & PassThrough {
  const req = new PassThrough() as IncomingMessage & PassThrough;
  req.url = options?.url ?? "/";
  req.headers = options?.headers ?? {};
  (req as IncomingMessage & { headersDistinct?: Record<string, string[]> }).headersDistinct =
    options?.headersDistinct;
  return req;
}

describe("httpServerRequest helpers", () => {
  it("builds base URL from request URL and config", () => {
    const req = createRequest({ url: "/mcp?x=1" });
    const url = baseUrlForRequest(req, {
      host: "127.0.0.1",
      port: 31415,
      path: "/mcp",
      token: "t",
    });
    expect(url.toString()).toBe("http://127.0.0.1:31415/mcp?x=1");
  });

  it("extracts bearer token in priority order", () => {
    const fromAuth = extractBearerToken(
      createRequest({
        headers: {
          authorization: "Bearer auth-token  ",
          "x-ailss-token": "header-token",
        },
      }),
      new URL("http://127.0.0.1:31415/mcp?token=query-token"),
    );
    expect(fromAuth).toBe("auth-token");

    const fromHeader = extractBearerToken(
      createRequest({
        headers: { "x-ailss-token": "header-token" },
      }),
      new URL("http://127.0.0.1:31415/mcp?token=query-token"),
    );
    expect(fromHeader).toBe("header-token");

    const fromQuery = extractBearerToken(
      createRequest({
        headers: {},
      }),
      new URL("http://127.0.0.1:31415/mcp?token=query-token"),
    );
    expect(fromQuery).toBe("query-token");

    const missing = extractBearerToken(
      createRequest({
        headers: {},
      }),
      new URL("http://127.0.0.1:31415/mcp"),
    );
    expect(missing).toBeNull();
  });

  it("parses json request body and handles empty/invalid/oversized payloads", async () => {
    const reqOk = createRequest();
    const bodyOkPromise = readJsonBody(reqOk, 10_000);
    reqOk.end(JSON.stringify({ method: "initialize" }));
    await expect(bodyOkPromise).resolves.toEqual({ method: "initialize" });

    const reqEmpty = createRequest();
    const bodyEmptyPromise = readJsonBody(reqEmpty, 10_000);
    reqEmpty.end("");
    await expect(bodyEmptyPromise).resolves.toBeUndefined();

    const reqInvalid = createRequest();
    const bodyInvalidPromise = readJsonBody(reqInvalid, 10_000);
    reqInvalid.end("{invalid");
    await expect(bodyInvalidPromise).rejects.toThrow("Invalid JSON body.");

    const reqTooLarge = createRequest();
    const bodyTooLargePromise = readJsonBody(reqTooLarge, 2);
    reqTooLarge.end("123");
    await expect(bodyTooLargePromise).rejects.toThrow("Request body too large.");
  });

  it("detects initialize requests from single and batch payloads", () => {
    expect(isInitializeRequestMessage({ method: "initialize" })).toBe(true);
    expect(isInitializeRequestMessage([{ method: "foo" }, { method: "initialize" }])).toBe(true);
    expect(isInitializeRequestMessage({ method: "tools/list" })).toBe(false);
    expect(isInitializeRequestMessage(undefined)).toBe(false);
  });

  it("reads single header value and rejects duplicates", () => {
    const singleDistinct = getSingleHeaderValue(
      createRequest({
        headersDistinct: { "mcp-session-id": ["s1"] },
      }),
      "mcp-session-id",
    );
    expect(singleDistinct).toBe("s1");

    const multipleDistinct = getSingleHeaderValue(
      createRequest({
        headersDistinct: { "mcp-session-id": ["s1", "s2"] },
      }),
      "mcp-session-id",
    );
    expect(multipleDistinct).toBe("multiple");

    const singleHeader = getSingleHeaderValue(
      createRequest({
        headers: { "mcp-session-id": "s1" },
      }),
      "mcp-session-id",
    );
    expect(singleHeader).toBe("s1");

    const multipleHeader = getSingleHeaderValue(
      createRequest({
        headers: { "mcp-session-id": ["s1", "s2"] },
      }),
      "mcp-session-id",
    );
    expect(multipleHeader).toBe("multiple");

    const none = getSingleHeaderValue(createRequest(), "mcp-session-id");
    expect(none).toBeNull();
  });
});
