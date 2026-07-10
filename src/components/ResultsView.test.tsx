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
      measure: () => {},
      measureElement: () => {},
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

const RESULT_WITH_EMPTY: QueryResponse = {
  columns: [
    { name: "State", type: "string" },
    { name: "Notes", type: "string" },
  ],
  rows: [
    ["TEXAS", null],
    ["KANSAS", ""],
  ],
  row_count: 2,
  elapsed_ms: 10,
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

  it("hides all-empty columns when the toggle is enabled", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ result: RESULT_WITH_EMPTY });
    render(<ResultsView />);

    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("2 columns")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide empty columns" }));

    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.getByText("1 column")).toBeInTheDocument();
    // Non-empty columns are untouched.
    expect(screen.getByText("State")).toBeInTheDocument();
  });

  it("disables the hide-empty toggle when there are no empty columns", () => {
    useAppStore.setState({ result: RESULT });
    render(<ResultsView />);
    expect(
      screen.getByRole("button", { name: "Hide empty columns" }),
    ).toBeDisabled();
  });

  it("switches cells from truncated to wrapped when wrap is toggled", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ result: RESULT });
    render(<ResultsView />);

    const cell = () => screen.getByText("TEXAS").closest("td");
    expect(cell()?.className).toContain("truncate");
    expect(cell()?.className).not.toContain("whitespace-pre-wrap");

    await user.click(screen.getByRole("button", { name: "Wrap text" }));

    expect(cell()?.className).toContain("whitespace-pre-wrap");
    expect(cell()?.className).not.toContain("truncate");
  });

  it("shows a value distribution when exploring a column", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    useAppStore.setState({ result: RESULT });
    render(<ResultsView />);

    await user.click(
      screen.getByRole("button", { name: "Explore values in State" }),
    );

    // Two distinct states, no nulls, both at 50%.
    expect(await screen.findByText("2 distinct")).toBeInTheDocument();
    expect(screen.getByText("0 null")).toBeInTheDocument();
    expect(screen.getAllByText(/50\.0%/)).toHaveLength(2);
  });
});
