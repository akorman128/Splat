// Classification. Shared by the upload route and the composer, which is why
// nothing here is server-only: the browser rejects an obviously bad drop before
// spending a round trip on it, and the server repeats the same call because a
// client-side check is a courtesy, not a gate.

export const ATTACHMENTS_BUCKET = "attachments";

// Every read of an attachment for the canvas names its columns rather than
// select("*"): extracted_text is megabytes on a long PDF and storage_path is
// the server's business. Keep in step with CardAttachment in lib/types.ts.
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

// The bucket's allowed_mime_types is the same list; a value that is not in it
// is rejected by Storage itself, so these two must not drift apart.
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

// Per kind, because the interesting number differs by an order of magnitude: a
// 25MB PDF is a normal report, a 25MB "text file" is a mistake.
export const SIZE_CAPS: Record<AttachmentKind, number> = {
  image: 8 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  document: 15 * 1024 * 1024,
  spreadsheet: 15 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

export const MAX_EXTRACTED_CHARS = 400_000;

// Below this a parse that "succeeded" has told us nothing — a scanned page, a
// slide deck of images. Worth saying out loud rather than sending an empty
// block and letting the model improvise.
export const EMPTY_TEXT_THRESHOLD = 20;

export const MAX_ATTACHMENTS_PER_TURN = 20;

// Images are the expensive half: they ride inline as base64, so a request that
// gathers too many is a request the provider will reject after we have already
// paid to download and encode them.
export const MAX_IMAGES_PER_REQUEST = 20;
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Extension wins over the browser's guess, and this list is why. The MIME
// database maps .ts to video/mp2t, so a TypeScript file arrives claiming to be
// video; .md and .csv routinely arrive as application/octet-stream. Matching
// here first, and only then applying the video rule to what is left, is what
// keeps source code attachable in an app people will attach source code to.
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

// Files people attach that have no extension at all.
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

// A leading dot is not an extension — `.gitignore` has none — so without this
// every dotfile falls past the text allowlist and is rejected as an unknown
// binary. The name up to the next dot is what the allowlist actually holds:
// `.env` and `.env.local` both answer "env".
export function dotfileName(filename: string): string {
  const base = basenameOf(filename);
  if (!base.startsWith(".")) return "";
  return base.slice(1).split(".")[0];
}

export type Classification =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; message: string };

// Order matters: text allowlist, then the formats we parse, then the explicit
// rejections. Anything reaching the bottom is a type we have no story for.
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

  // Own-property lookups only: these are object literals, so `x.constructor`
  // would otherwise come back as the Object function — truthy, and passed
  // straight through as a MIME type.
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

// Cosmetic — the path is <id><ext> and the id is what makes it unique — but a
// readable suffix makes a bucket listing legible.
export function storageExtension(filename: string): string {
  const extension = extensionOf(filename).replace(/[^a-z0-9]/g, "");
  return extension && extension.length <= 12 ? `.${extension}` : "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
