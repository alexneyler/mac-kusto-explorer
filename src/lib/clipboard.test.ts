import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../store/toast";
import { copyText, qualifiedName, quoteKustoIdentifier } from "./clipboard";

const mockWriteText = vi.mocked(writeText);

describe("clipboard helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  it("copies text and reports success", async () => {
    mockWriteText.mockResolvedValue(undefined);

    await copyText("hello", "Value");

    expect(mockWriteText).toHaveBeenCalledWith("hello");
    expect(useToastStore.getState().toasts[0]?.message).toBe(
      "Value copied to clipboard",
    );
  });

  it("quotes identifiers only when Kusto requires it", () => {
    expect(quoteKustoIdentifier("Events")).toBe("Events");
    expect(quoteKustoIdentifier("Event Name")).toBe("['Event Name']");
    expect(quoteKustoIdentifier("owner's table")).toBe(
      "['owner''s table']",
    );
    expect(qualifiedName("My DB", "Events")).toBe("['My DB'].Events");
  });
});
