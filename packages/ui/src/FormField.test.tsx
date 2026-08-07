import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("associates the label with the control via htmlFor/id", () => {
    render(
      <FormField label="Email">{(fieldProps) => <input {...fieldProps} type="email" />}</FormField>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("wires hint text into aria-describedby", () => {
    render(
      <FormField label="Email" hint="Usa la tua email di lavoro">
        {(fieldProps) => <input {...fieldProps} type="email" />}
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Usa la tua email di lavoro");
  });

  it("wires error text into aria-describedby with role=alert, alongside hint when both are present", () => {
    render(
      <FormField label="Email" hint="Un suggerimento" error="Campo obbligatorio">
        {(fieldProps) => <input {...fieldProps} type="email" />}
      </FormField>,
    );
    const input = screen.getByLabelText("Email");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    const ids = describedBy.split(" ");
    expect(ids).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Campo obbligatorio");
  });

  it("omits aria-describedby entirely when neither hint nor error is provided", () => {
    render(<FormField label="Email">{(fieldProps) => <input {...fieldProps} type="email" />}</FormField>);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-describedby");
  });
});
