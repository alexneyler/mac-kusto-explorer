// Display formatting for a single result cell. Kept pure and separate from the
// grid component so the type-specific rendering rules can be unit-tested.

export interface CellDisplay {
  text: string;
  /** Right-align and use a numeric tint. */
  numeric: boolean;
  /** Render as a muted `null` placeholder. */
  isNull: boolean;
  /** Dynamic (object/array) value rendered as JSON. */
  dynamic: boolean;
}

export function formatCell(value: unknown): CellDisplay {
  if (value === null || value === undefined) {
    return { text: "null", numeric: false, isNull: true, dynamic: false };
  }
  if (typeof value === "number") {
    return { text: String(value), numeric: true, isNull: false, dynamic: false };
  }
  if (typeof value === "boolean") {
    return {
      text: value ? "true" : "false",
      numeric: false,
      isNull: false,
      dynamic: false,
    };
  }

  if (typeof value === "string") {
    return { text: value, numeric: false, isNull: false, dynamic: false };
  }
  // Arrays and objects (Kusto `dynamic`) render as compact JSON.
  return {
    text: JSON.stringify(value),
    numeric: false,
    isNull: false,
    dynamic: true,
  };
}

export function cellJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

export function kustoLiteral(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `dynamic(${JSON.stringify(JSON.stringify(value))})`;
}

export function rowAsTsv(row: unknown[]): string {
  return row
    .map((value) => formatCell(value).text.replace(/\t/g, " "))
    .join("\t");
}

export function rowAsJson(columns: { name: string }[], row: unknown[]): string {
  return JSON.stringify(
    Object.fromEntries(columns.map((column, index) => [column.name, row[index]])),
    null,
    2,
  );
}

export function rowAsMarkdown(
  columns: { name: string }[],
  row: unknown[],
): string {
  const escape = (value: string) =>
    value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${columns.map((column) => escape(column.name)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const values = `| ${row
    .map((value) => escape(formatCell(value).text))
    .join(" | ")} |`;
  return [header, separator, values].join("\n");
}
