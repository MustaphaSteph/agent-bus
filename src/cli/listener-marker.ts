import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { busDir } from "../util/paths.js";

interface MarkerPayload {
  agent: string;
  pid: number;
  started_at: number;
}

function markersDir(): string {
  const dir = join(busDir(), "listeners");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function markerPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return join(markersDir(), `${safe}.json`);
}

export function markListening(sessionId: string, agent: string): void {
  const payload: MarkerPayload = { agent, pid: process.pid, started_at: Date.now() };
  writeFileSync(markerPath(sessionId), JSON.stringify(payload));
}

export function unmarkListening(sessionId: string): void {
  const path = markerPath(sessionId);
  if (existsSync(path)) unlinkSync(path);
}

export function readListenerMarker(sessionId: string): MarkerPayload | null {
  const path = markerPath(sessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as MarkerPayload;
  } catch {
    return null;
  }
}
