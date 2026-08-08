import type { ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption?: ReactNode;
}

/**
 * Baseline accessible data table (07_04 §10, §13, WEB-M3B 02_35 §5/§7):
 * a real `<table>` with `<caption>`/`scope="col"` headers, never a div
 * grid — screen readers need the semantic table structure to announce
 * row/column relationships (rosters, review queue).
 */
export function Table<T>({ columns, rows, rowKey, caption }: TableProps<T>) {
  return (
    <table className="qc-table">
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.key}>{column.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
