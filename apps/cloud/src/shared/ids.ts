export function newId(prefix: string): string {
  const random = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}_${random}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function now(): number {
  return Date.now();
}
