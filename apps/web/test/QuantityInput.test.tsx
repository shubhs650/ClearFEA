// SPDX-License-Identifier: AGPL-3.0-or-later
// The shared quantity input (M2.1, ADR-038): units of the field's kind only, the project
// system's unit offered first, values reported as typed and never converted.

import type { Quantity } from "@clearfea/spec";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuantityInput } from "../src/units/QuantityInput";
import { type QuantityKind, UnitSystemProvider } from "../src/units/system";

function Harness({
  system,
  kind,
  initial = null,
  onChange,
}: {
  system: string;
  kind: QuantityKind;
  initial?: Quantity | null;
  onChange: (value: Quantity | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <UnitSystemProvider value={system}>
      <QuantityInput
        label="Value"
        kind={kind}
        positive
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </UnitSystemProvider>
  );
}

const unit = () => screen.getByLabelText("Value unit") as HTMLSelectElement;

afterEach(cleanup);

describe("quantity input", () => {
  it("lists only the units of its kind", () => {
    render(<Harness system="metric-mm" kind="temperatureDifference" onChange={() => {}} />);
    expect([...unit().options].map((o) => o.value)).toEqual(["K", "°C", "°F"]);
    expect(unit().value).toBe("°C");
  });

  it("reports the value with the unit shown, unconverted", () => {
    const onChange = vi.fn();
    render(<Harness system="us-in" kind="density" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "0.284" } });
    expect(onChange).toHaveBeenLastCalledWith({ value: 0.284, unit: "lb/in³" });
    fireEvent.change(unit(), { target: { value: "kg/m³" } });
    expect(onChange).toHaveBeenLastCalledWith({ value: 0.284, unit: "kg/m³" });
  });

  it("follows the system while empty, but keeps a unit the user picked", () => {
    const { rerender } = render(<Harness system="metric-mm" kind="length" onChange={() => {}} />);
    expect(unit().value).toBe("mm");
    rerender(<Harness system="si" kind="length" onChange={() => {}} />);
    expect(unit().value).toBe("m");
    fireEvent.change(unit(), { target: { value: "ft" } });
    rerender(<Harness system="us-in" kind="length" onChange={() => {}} />);
    expect(unit().value).toBe("ft");
  });

  it("keeps a stored value's unit whatever the system", () => {
    render(<Harness system="us-in" kind="pressure" initial={{ value: 200, unit: "GPa" }} onChange={() => {}} />);
    expect(unit().value).toBe("GPa");
    expect(screen.getByLabelText("Value")).toHaveProperty("value", "200");
  });

  it("keeps text that is not a positive number out of the value and says why", () => {
    const onChange = vi.fn();
    render(<Harness system="si" kind="force" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "1e" } });
    expect(screen.getByText("Enter a number, for example 210 or 2.1e5.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "-3" } });
    expect(screen.getByText("Enter a value greater than 0.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
