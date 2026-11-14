import { describe, it, expect } from "vitest";
import { validateExperimentForm } from "./useExperimentsPage.js";

describe("ExperimentsPage ViewModel", () => {
  it("validates experiment form - valid", () => {
    const form = {
      name: "Test A vs B",
      description: "Compare discount strategies",
      variants: [
        { name: "Control", description: "No discount" },
        { name: "Variant A", description: "15% discount" },
      ],
      sample_size: 100,
    };
    const errors = validateExperimentForm(form);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("validates experiment form - missing name", () => {
    const form = {
      name: "",
      variants: [
        { name: "Control" },
        { name: "Variant A" },
      ],
      sample_size: 100,
    };
    const errors = validateExperimentForm(form);
    expect(errors.name).toBeDefined();
  });

  it("validates experiment form - insufficient variants", () => {
    const form = {
      name: "Test",
      variants: [{ name: "Control" }],
      sample_size: 100,
    };
    const errors = validateExperimentForm(form);
    expect(errors.variants).toBeDefined();
  });

  it("validates experiment form - invalid sample size", () => {
    const form = {
      name: "Test",
      variants: [
        { name: "Control" },
        { name: "Variant A" },
      ],
      sample_size: 5, // Too small
    };
    const errors = validateExperimentForm(form);
    expect(errors.sample_size).toBeDefined();
  });

  it("validates experiment form - too many variants", () => {
    const form = {
      name: "Test",
      variants: Array(12)
        .fill(null)
        .map((_, i) => ({ name: `Variant ${i}` })),
      sample_size: 100,
    };
    const errors = validateExperimentForm(form);
    expect(errors.variants).toBeDefined();
  });
});
