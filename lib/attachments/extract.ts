import "server-only";
import { estimateImageTokens, estimateTokens } from "@/lib/tokens";
import {
  EMPTY_TEXT_THRESHOLD,
  MAX_EXTRACTED_CHARS,
  type AttachmentKind,
  type ExtractStatus,
} from "./types";

export type ExtractResult = {
  status: ExtractStatus;
  text: string | null;
  error: string | null;
  truncated: boolean;
  estTokens: number;
  width: number | null;
  height: number | null;
};

// Extraction happens once, at upload, and never again: the context picker has
// to price a file in tokens before the prompt is ever sent, and that number
// cannot exist until the text does. The parsers are loaded on demand so a PNG
// upload never pays to initialise the PDF engine.

async function fromPdf(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  // pdf.js takes ownership of the buffer it is handed, so it gets a copy.
  const { text } = await extractText(new Uint8Array(bytes), {
    mergePages: true,
  });
  return text;
}

async function fromDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  return value;
}

// A cell is not a string. read-excel-file hands back Date objects, booleans and
// numbers, and a formula that returned nothing comes through as null — so every
// value goes through here or the sheet renders as a wall of [object Object].
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value);
}

function toCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function fromXlsx(bytes: Uint8Array): Promise<string> {
  const readXlsxFile = (await import("read-excel-file/node")).default;
  const sheets = await readXlsxFile(Buffer.from(bytes));
  return sheets
    .map(({ sheet, data }) => {
      const rows = data
        .map((row) => row.map((cell) => toCsvField(cellToString(cell))).join(","))
        // A spreadsheet's used range is routinely padded with empty rows.
        .filter((row) => row.replaceAll(",", "").length > 0);
      return `# Sheet: ${sheet}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

const NUL = String.fromCharCode(0);

function fromText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  // A NUL in the first few KB is the cheapest reliable "this is not text".
  // Without it, a binary renamed to .txt becomes 2MB of replacement characters.
  if (text.slice(0, 8192).includes(NUL)) {
    throw new Error("This looks like a binary file, not text.");
  }
  return text;
}

// Never fatal: a dimensionless image is a worse token estimate, not a failed
// upload.
async function measure(
  bytes: Uint8Array,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const { imageSize } = await import("image-size");
    const { width, height } = imageSize(bytes);
    return { width: width ?? null, height: height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export async function extractAttachment(
  bytes: Uint8Array,
  kind: AttachmentKind,
): Promise<ExtractResult> {
  if (kind === "image") {
    const { width, height } = await measure(bytes);
    return {
      status: "skipped",
      text: null,
      error: null,
      truncated: false,
      estTokens: estimateImageTokens(width, height),
      width,
      height,
    };
  }

  let raw: string;
  try {
    raw =
      kind === "pdf"
        ? await fromPdf(bytes)
        : kind === "document"
          ? await fromDocx(bytes)
          : kind === "spreadsheet"
            ? await fromXlsx(bytes)
            : fromText(bytes);
  } catch (err) {
    return {
      status: "failed",
      text: null,
      error: err instanceof Error ? err.message : "Could not read this file",
      truncated: false,
      estTokens: 0,
      width: null,
      height: null,
    };
  }

  const normalised = raw.replace(/\r\n/g, "\n").trim();
  if (normalised.length < EMPTY_TEXT_THRESHOLD) {
    return {
      status: "empty",
      text: null,
      error: null,
      truncated: false,
      estTokens: 0,
      width: null,
      height: null,
    };
  }

  const truncated = normalised.length > MAX_EXTRACTED_CHARS;
  const text = truncated ? normalised.slice(0, MAX_EXTRACTED_CHARS) : normalised;
  return {
    status: "ok",
    text,
    error: null,
    truncated,
    estTokens: estimateTokens(text),
    width: null,
    height: null,
  };
}
