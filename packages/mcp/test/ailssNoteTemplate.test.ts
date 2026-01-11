import { describe, expect, it } from "vitest";

import { idFromIsoSeconds, nowIsoSeconds } from "../src/lib/ailssNoteTemplate.js";

describe("ailssNoteTemplate timestamps", () => {
  it("generates local ISO seconds without UTC helpers", () => {
    const originalToISOString = Date.prototype.toISOString;
    const originalGetUTCFullYear = Date.prototype.getUTCFullYear;
    const originalGetUTCMonth = Date.prototype.getUTCMonth;
    const originalGetUTCDate = Date.prototype.getUTCDate;
    const originalGetUTCHours = Date.prototype.getUTCHours;
    const originalGetUTCMinutes = Date.prototype.getUTCMinutes;
    const originalGetUTCSeconds = Date.prototype.getUTCSeconds;

    try {
      Date.prototype.toISOString = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.toISOString()");
      };
      Date.prototype.getUTCFullYear = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCFullYear()");
      };
      Date.prototype.getUTCMonth = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCMonth()");
      };
      Date.prototype.getUTCDate = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCDate()");
      };
      Date.prototype.getUTCHours = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCHours()");
      };
      Date.prototype.getUTCMinutes = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCMinutes()");
      };
      Date.prototype.getUTCSeconds = () => {
        throw new Error("nowIsoSeconds must not call Date.prototype.getUTCSeconds()");
      };

      const value = nowIsoSeconds();
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

      const id = idFromIsoSeconds(value);
      expect(id).toMatch(/^\d{14}$/);
    } finally {
      Date.prototype.toISOString = originalToISOString;
      Date.prototype.getUTCFullYear = originalGetUTCFullYear;
      Date.prototype.getUTCMonth = originalGetUTCMonth;
      Date.prototype.getUTCDate = originalGetUTCDate;
      Date.prototype.getUTCHours = originalGetUTCHours;
      Date.prototype.getUTCMinutes = originalGetUTCMinutes;
      Date.prototype.getUTCSeconds = originalGetUTCSeconds;
    }
  });
});
