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
