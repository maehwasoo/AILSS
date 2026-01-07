export type LinePatchOp =
  | {
      op: "insert_lines";
      at_line: number;
      text: string;
    }
  | {
      op: "delete_lines";
      from_line: number;
      to_line: number;
    }
  | {
      op: "replace_lines";
      from_line: number;
      to_line: number;
      text: string;
    };

export type ApplyLinePatchResult = {
  text: string;
  eol: "\n" | "\r\n";
};

function parsePatchText(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const parts = normalized.split("\n");
  if (endsWithNewline) parts.pop();
  return parts;
}

function detectEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function applyLinePatchOps(originalText: string, ops: LinePatchOp[]): ApplyLinePatchResult {
  const eol = detectEol(originalText);
  const normalized = originalText.replace(/\r\n/g, "\n");

  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hadTrailingNewline) lines.pop();

  for (const op of ops) {
    switch (op.op) {
      case "insert_lines": {
        const maxAtLine = lines.length + 1;
        if (op.at_line < 1 || op.at_line > maxAtLine) {
          throw new Error(
            `insert_lines.at_line out of range: ${op.at_line} (valid: 1..${maxAtLine})`,
          );
        }
        const insertAt = op.at_line - 1;
        const insertLines = parsePatchText(op.text);
        lines.splice(insertAt, 0, ...insertLines);
        break;
      }
      case "delete_lines": {
        if (op.from_line < 1 || op.to_line < 1) {
          throw new Error("delete_lines line numbers must be >= 1.");
        }
        if (op.to_line < op.from_line) {
          throw new Error(
            `delete_lines.to_line must be >= from_line (from=${op.from_line}, to=${op.to_line}).`,
          );
        }
        const maxLine = lines.length;
        if (op.from_line > maxLine || op.to_line > maxLine) {
          throw new Error(
            `delete_lines range out of bounds: ${op.from_line}..${op.to_line} (max line: ${maxLine}).`,
          );
        }

        const start = op.from_line - 1;
        const count = op.to_line - op.from_line + 1;
        lines.splice(start, count);
        break;
      }
      case "replace_lines": {
        if (op.from_line < 1 || op.to_line < 1) {
          throw new Error("replace_lines line numbers must be >= 1.");
        }
        if (op.to_line < op.from_line) {
          throw new Error(
            `replace_lines.to_line must be >= from_line (from=${op.from_line}, to=${op.to_line}).`,
          );
        }
        const maxLine = lines.length;
        if (op.from_line > maxLine || op.to_line > maxLine) {
          throw new Error(
            `replace_lines range out of bounds: ${op.from_line}..${op.to_line} (max line: ${maxLine}).`,
          );
        }

        const start = op.from_line - 1;
        const count = op.to_line - op.from_line + 1;
        const replacementLines = parsePatchText(op.text);
        lines.splice(start, count, ...replacementLines);
        break;
      }
      default: {
        const _exhaustive: never = op;
        return _exhaustive;
      }
    }
  }

  let out = lines.join("\n");
  if (hadTrailingNewline) out += "\n";
  if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");

  return { text: out, eol };
}
