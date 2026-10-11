export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_FILES = 5;
export const WORKSPACE_FILE_BYTES = 512 * 1024 * 1024;
export const DRAFT_FILE_TTL = 24 * 60 * 60 * 1000;

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  content_type: string;
  url: string;
}

export function attachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_FILES ||
      value.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) || new Set(value).size !== value.length) {
    throw new Error(`Choose up to ${MAX_MESSAGE_FILES} different attachments.`);
  }
  return value as string[];
}

export function cleanFilename(value: string): string {
  const name = value.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/g, "_").trim().slice(0, 180);
  return name && name !== "." && name !== ".." ? name : "attachment";
}

// Never trust the supplied MIME type. Only recognized raster formats render inline.
export function imageContentType(bytes: Uint8Array): string {
  const begins = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (begins([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (begins([255, 216, 255])) return "image/jpeg";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return "application/octet-stream";
}
