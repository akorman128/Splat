export const ATTACHMENTS_BUCKET = "attachments";

// Keep in step with CardAttachment in lib/types.ts.
export const CARD_ATTACHMENT_COLUMNS =
  "id, conversation_id, node_id, filename, mime_type, byte_size, kind, image_width, image_height, extract_status, extract_error, truncated, est_tokens, created_at";

export type AttachmentKind =
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "text";

export type ExtractStatus = "pending" | "ok" | "empty" | "failed" | "skipped";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The bucket's allowed_mime_types is the same list and must not drift from it.
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export const SIZE_CAPS: Record<AttachmentKind, number> = {
  image: 8 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  document: 15 * 1024 * 1024,
  spreadsheet: 15 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

export const MAX_EXTRACTED_CHARS = 400_000;

export const EMPTY_TEXT_THRESHOLD = 20;

// Scanned pages often carry a stamped header or footer in real text, which clears
// the threshold above for the whole file while leaving every page unread. What
// decides a PDF is how much text a page has, not how much the document has.
export const PDF_MIN_CHARS_PER_PAGE = 50;

export const MAX_ATTACHMENTS_PER_TURN = 20;

// CardAttachmentList derives its query staleTime from this.
export const SIGNED_URL_TTL_SECONDS = 3600;

export const MAX_IMAGES_PER_REQUEST = 20;
// Images and whole PDFs share one budget because they share one request body.
// Base64 costs a third more than the bytes it encodes, so 20 MB of attachments
// arrives as ~27 MB — inside the 32 MB request Anthropic accepts, with room for
// the prompt.
export const MAX_INLINE_BYTES = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Matched before the browser's reported MIME, which maps .ts to video/mp2t and
// sends .md and .csv as application/octet-stream.
const TEXT_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "asciidoc", "tex",
  "csv", "tsv", "json", "jsonc", "json5", "ndjson", "yaml", "yml", "toml",
  "ini", "cfg", "conf", "properties", "env", "log", "xml", "svg", "html",
  "htm", "css", "scss", "sass", "less", "styl",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "py", "pyi", "rb", "rake", "go", "rs", "java", "kt", "kts", "scala", "clj",
  "cljs", "cljc", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "swift",
  "m", "mm", "php", "pl", "pm", "r", "jl", "lua", "dart", "ex", "exs", "erl",
  "hrl", "hs", "elm", "nim", "zig", "v", "vb", "f90", "for", "asm", "s",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "gql", "proto", "tf", "tfvars", "hcl", "nix",
  "vue", "svelte", "astro", "hbs", "ejs", "erb", "jinja", "j2", "liquid",
  "patch", "diff", "lock", "gradle", "sbt", "cabal", "podspec", "gemspec",
  "gitignore", "gitattributes", "dockerignore", "editorconfig", "npmrc",
  "nvmrc", "prettierrc", "eslintrc", "babelrc", "browserslistrc",
]);

const TEXT_BASENAMES = new Set([
  "dockerfile", "makefile", "rakefile", "gemfile", "procfile", "brewfile",
  "justfile", "readme", "license", "licence", "notice", "changelog",
  "authors", "contributors", "codeowners", "vagrantfile", "jenkinsfile",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "mpg", "mpeg",
  "3gp", "ogv", "m2ts", "mts",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "flac", "aac", "ogg", "oga", "m4a", "wma", "aiff", "opus",
]);

const LEGACY_OFFICE: Record<string, string> = {
  doc: "Word",
  xls: "Excel",
  ppt: "PowerPoint",
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function basenameOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.toLowerCase();
}

// A leading dot is not an extension, so `.env` and `.env.local` both answer
// "env" — the form the allowlist holds.
export function dotfileName(filename: string): string {
  const base = basenameOf(filename);
  if (!base.startsWith(".")) return "";
  return base.slice(1).split(".")[0];
}

export type Classification =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; message: string };

// Order matters: text allowlist, then parsed formats, then explicit rejections.
export function classify(filename: string, reported: string): Classification {
  const extension = extensionOf(filename);
  const basename = basenameOf(filename);
  const mime = reported.split(";")[0].trim().toLowerCase();

  const dotfile = dotfileName(filename);
  if (
    TEXT_EXTENSIONS.has(extension) ||
    TEXT_BASENAMES.has(basename) ||
    (dotfile !== "" &&
      (TEXT_EXTENSIONS.has(dotfile) || TEXT_BASENAMES.has(dotfile)))
  ) {
    return { ok: true, kind: "text", mimeType: "text/plain" };
  }

  // Own-property lookups only: on an object literal `x.constructor` is truthy
  // and would be passed straight through as a MIME type.
  const imageMime = Object.hasOwn(IMAGE_EXTENSIONS, extension)
    ? IMAGE_EXTENSIONS[extension]
    : undefined;
  if (imageMime) return { ok: true, kind: "image", mimeType: imageMime };
  if (isImageMimeType(mime)) return { ok: true, kind: "image", mimeType: mime };
  if (mime.startsWith("image/")) {
    return {
      ok: false,
      message: `${mime.slice(6).toUpperCase()} images aren't supported — use PNG, JPEG, GIF, or WebP.`,
    };
  }

  if (extension === "pdf" || mime === "application/pdf") {
    return { ok: true, kind: "pdf", mimeType: "application/pdf" };
  }
  if (extension === "docx" || mime === DOCX_MIME) {
    return { ok: true, kind: "document", mimeType: DOCX_MIME };
  }
  if (extension === "xlsx" || mime === XLSX_MIME) {
    return { ok: true, kind: "spreadsheet", mimeType: XLSX_MIME };
  }

  if (VIDEO_EXTENSIONS.has(extension) || mime.startsWith("video/")) {
    return {
      ok: false,
      message:
        "Video isn't supported. Attach a still frame, or a transcript as text.",
    };
  }
  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) {
    return {
      ok: false,
      message: "Audio isn't supported. Attach a transcript as text instead.",
    };
  }
  const legacy = Object.hasOwn(LEGACY_OFFICE, extension)
    ? LEGACY_OFFICE[extension]
    : undefined;
  if (legacy) {
    return {
      ok: false,
      message: `Legacy ${legacy} files aren't supported — re-save it as .${extension}x.`,
    };
  }
  if (mime.startsWith("text/")) {
    return { ok: true, kind: "text", mimeType: "text/plain" };
  }

  return {
    ok: false,
    message: `${extension ? `.${extension}` : "That"} files aren't supported. Attach an image, PDF, .docx, .xlsx, or a text file.`,
  };
}

export function storageExtension(filename: string): string {
  const extension = extensionOf(filename).replace(/[^a-z0-9]/g, "");
  return extension && extension.length <= 12 ? `.${extension}` : "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sizeCapMessage(size: number, cap: number): string {
  return `${formatBytes(size)} — the limit for this kind of file is ${formatBytes(cap)}.`;
}

// A textless PDF is sent whole for the model to read, so it has nothing to
// report. Every other file with no text does.
export function sentAsPages(attachment: {
  kind: string;
  extract_status: string;
}): boolean {
  return attachment.kind === "pdf" && attachment.extract_status === "empty";
}

export function missingTextNotice(attachment: {
  kind: string;
  extract_status: string;
  extract_error?: string | null;
}): { short: string; title: string } | null {
  if (attachment.extract_status === "failed") {
    return {
      short: "unreadable",
      title:
        attachment.extract_error ??
        "The text of this file could not be read; it will not be sent.",
    };
  }
  if (attachment.extract_status === "empty" && !sentAsPages(attachment)) {
    return {
      short: "no text",
      title:
        "This file parsed cleanly but holds no text — a scan, most likely. The model will not be able to read it.",
    };
  }
  return null;
}
