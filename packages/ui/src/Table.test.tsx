import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, type TableColumn } from "./Table";

interface Row {
  id: string;
  name: string;
}

const COLUMNS: Array<TableColumn<Row>> = [
  { key: "name", header: "Nome", render: (row) => row.name },
];

describe("Table", () => {
  it("renders a real <table> with a caption and column headers using scope=col", () => {
    render(<Table columns={COLUMNS} rows={[]} rowKey={(row) => row.id} caption="Elenco studenti" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Elenco studenti")).toBeInTheDocument();
    const header = screen.getByRole("columnheader", { name: "Nome" });
    expect(header).toHaveAttribute("scope", "col");
  });

  it("renders one row per item, using rowKey for React keys and column.render for cell content", () => {
    const rows: Row[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];
    render(<Table columns={COLUMNS} rows={rows} rowKey={(row) => row.id} />);
    expect(screen.getAllByRole("row")).toHaveLength(3); // 1 header row + 2 data rows
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders no caption element when none is provided", () => {
    const { container } = render(<Table columns={COLUMNS} rows={[]} rowKey={(row) => row.id} />);
    expect(container.querySelector("caption")).toBeNull();
  });
});
