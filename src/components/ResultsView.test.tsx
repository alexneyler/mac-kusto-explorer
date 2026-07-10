import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The virtualizer relies on real layout, which jsdom lacks. Mock it to emit a
// window covering every row so we can assert on the component's own row/cell
// rendering deterministically.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const items = Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: index * 28,
      end: (index + 1) * 28,
      size: 28,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * 28,
    };
  },
}));

import { baseDataState, useAppStore } from "../store/appStore";
import type { QueryResponse } from "../types/kusto";
import { ResultsView } from "./ResultsView";

const RESULT: QueryResponse = {
  columns: [
    { name: "State", type: "string" },
    { name: "Count", type: "long" },
  ],
  rows: [
    ["TEXAS", 4701],
    ["KANSAS", 3166],
  ],
  row_count: 2,
  elapsed_ms: 42,
};

beforeEach(() => {
  useAppStore.setState(baseDataState());
});

describe("ResultsView", () => {
  it("shows an empty prompt before any query runs", () => {
    render(<ResultsView />);
    expect(screen.getByText(/Run a query to see results/i)).toBeInTheDocument();
  });

  it("shows a loading indicator while running", () => {
    useAppStore.setState({ running: true });
    render(<ResultsView />);
    expect(screen.getByText(/Running query/i)).toBeInTheDocument();
  });

  it("renders an error banner with the kind and message", () => {
    useAppStore.setState({ error: { kind: "kusto", message: "Syntax error" } });
    render(<ResultsView />);
    expect(screen.getByText(/kusto error/i)).toBeInTheDocument();
    expect(screen.getByText("Syntax error")).toBeInTheDocument();
  });

  it("renders the grid header, status bar, and cells for a result", () => {
    useAppStore.setState({ result: RESULT });
    render(<ResultsView />);

    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();

    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.getByText("2 columns")).toBeInTheDocument();
    expect(screen.getByText("42 ms")).toBeInTheDocument();

    expect(screen.getByText("TEXAS")).toBeInTheDocument();
    expect(screen.getByText("4701")).toBeInTheDocument();
    expect(screen.getByText("KANSAS")).toBeInTheDocument();
  });

  it("switches to the chart view via the Table/Chart toggle", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ result: RESULT });
    render(<ResultsView />);

    // Table view first: no chart-type control yet.
    expect(screen.queryByLabelText("Chart type")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /chart/i }));

    // Chart controls appear, with numeric column auto-detected as a series.
    expect(screen.getByLabelText("Chart type")).toBeInTheDocument();
    expect(screen.getByLabelText("X axis column")).toBeInTheDocument();

    // And back to the table.
    await user.click(screen.getByRole("button", { name: /table/i }));
    expect(screen.queryByLabelText("Chart type")).not.toBeInTheDocument();
  });

  it("shows a friendly message when there are no numeric columns to chart", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      result: {
        columns: [
          { name: "State", type: "string" },
          { name: "City", type: "string" },
        ],
        rows: [["TX", "Austin"]],
        row_count: 1,
        elapsed_ms: 5,
      },
    });
    render(<ResultsView />);

    await user.click(screen.getByRole("button", { name: /chart/i }));
    expect(screen.getByText(/No numeric columns to chart/i)).toBeInTheDocument();
  });
});
