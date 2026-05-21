import { readFileSync } from "node:fs";

const FALLBACK_VERSION = "0.7.0";

export function packageVersion(): string {
  try {
    const packageJsonUrl = new URL("../../package.json", import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
