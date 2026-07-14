import { useAppStore } from "../store/appStore";

type QueryResolver = () => Promise<string>;

let activeQueryResolver: QueryResolver | null = null;

/** Register the resolver owned by the currently mounted query editor. */
export function registerQueryResolver(resolver: QueryResolver): () => void {
  activeQueryResolver = resolver;
  return () => {
    if (activeQueryResolver === resolver) activeQueryResolver = null;
  };
}

/** Run the selection or command at the active editor cursor. */
export async function runEditorQuery(): Promise<void> {
  const query = activeQueryResolver ? await activeQueryResolver() : undefined;
  await useAppStore.getState().runActiveQuery(query);
}

/**
 * Resolve a command without language-service support. Blank separator lines
 * belong to the command above them, matching Kusto Explorer's cursor behavior.
 */
export function queryAtCursor(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): string {
  const startOffset = clampOffset(selectionStart, text.length);
  const endOffset = clampOffset(selectionEnd, text.length);
  if (startOffset !== endOffset) {
    return text.slice(
      Math.min(startOffset, endOffset),
      Math.max(startOffset, endOffset),
    );
  }

  const lines = text.split("\n");
  let lineIndex = text.slice(0, startOffset).split("\n").length - 1;

  if (lines[lineIndex]?.trim() === "") {
    while (lineIndex >= 0 && lines[lineIndex].trim() === "") lineIndex -= 1;
    if (lineIndex < 0) {
      lineIndex = 0;
      while (lineIndex < lines.length && lines[lineIndex].trim() === "") {
        lineIndex += 1;
      }
    }
  }

  if (lineIndex >= lines.length) return "";

  let firstLine = lineIndex;
  while (firstLine > 0 && lines[firstLine - 1].trim() !== "") firstLine -= 1;

  let lastLine = lineIndex;
  while (
    lastLine + 1 < lines.length &&
    lines[lastLine + 1].trim() !== ""
  ) {
    lastLine += 1;
  }

  return lines.slice(firstLine, lastLine + 1).join("\n");
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length));
}
