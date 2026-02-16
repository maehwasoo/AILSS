import type { ServerResponse } from "node:http";

export function applySdkResponseCompatibilityFixes(
  res: ServerResponse,
  options?: { notificationResponseBody?: string | null },
): void {
  const notificationResponseBody = options?.notificationResponseBody ?? null;
  const originalWriteHead = res.writeHead.bind(res) as unknown as (
    statusCode: number,
    ...rest: unknown[]
  ) => ServerResponse;
  const originalEnd = res.end.bind(res) as unknown as (...args: unknown[]) => ServerResponse;

  // SDK error responses frequently omit Content-Type even though the body is JSON-RPC.
  // Only default the header for 4xx/5xx so we don't advertise JSON on empty 200 responses
  // (e.g. DELETE /mcp) and trigger client-side JSON parse errors.
  res.writeHead = ((statusCode: number, ...rest: unknown[]): ServerResponse => {
    if (typeof statusCode === "number") {
      if (statusCode === 202 && notificationResponseBody) {
        if (!res.getHeader("content-type")) {
          res.setHeader("content-type", "application/json; charset=utf-8");
        }
      } else if (statusCode >= 400) {
        if (!res.getHeader("content-type")) {
          res.setHeader("content-type", "application/json; charset=utf-8");
        }
      }
    }
    return originalWriteHead(statusCode, ...rest);
  }) as unknown as ServerResponse["writeHead"];

  res.end = ((...args: unknown[]): ServerResponse => {
    if (notificationResponseBody && res.statusCode === 202) {
      const first = args[0];
      const firstIsCallback = typeof first === "function";
      const hasBody =
        !firstIsCallback &&
        args.length > 0 &&
        first !== undefined &&
        first !== null &&
        !(
          (typeof first === "string" && first.length === 0) ||
          (first instanceof Uint8Array && first.byteLength === 0)
        );

      if (!hasBody) {
        if (!res.getHeader("content-type") && !res.headersSent) {
          res.setHeader("content-type", "application/json; charset=utf-8");
        }

        if (args.length === 0) return originalEnd(notificationResponseBody);
        if (firstIsCallback) return originalEnd(notificationResponseBody, first);
        return originalEnd(notificationResponseBody, ...args.slice(1));
      }
    }

    // Defensive: cover any future SDK paths that call end() without writeHead().
    if (res.statusCode >= 400) {
      if (!res.getHeader("content-type")) {
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
    }
    return originalEnd(...args);
  }) as unknown as ServerResponse["end"];
}
