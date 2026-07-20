import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { showToast } from "../store/toast";
import { errorMessage } from "../types/kusto";

export async function copyText(text: string, label = "Text"): Promise<void> {
  try {
    await writeText(text);
    showToast(`${label} copied to clipboard`, "success");
  } catch (error) {
    showToast(errorMessage(error), "error");
  }
}

export function qualifiedName(...parts: string[]): string {
  return parts.map(quoteKustoIdentifier).join(".");
}

export function quoteKustoIdentifier(identifier: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)
    ? identifier
    : `['${identifier.replace(/'/g, "''")}']`;
}
