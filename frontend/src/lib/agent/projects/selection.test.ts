import { describe, expect, it } from "vitest";
import { projectPathById, resolveSelectedProjectId } from "./selection";
import type { Project } from "./types";

const projects: Project[] = [
  {
    id: "p1",
    name: "One",
    path: "/work/one",
    addedAt: "2026-05-12T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "main",
  },
  {
    id: "p2",
    name: "Two",
    path: "/work/two",
    addedAt: "2026-05-12T00:00:00.000Z",
    exists: true,
    hasGit: false,
    branch: null,
  },
];

describe("project selection helpers", () => {
  it("keeps the current selection when it still exists", () => {
    expect(resolveSelectedProjectId("p2", projects)).toBe("p2");
  });

  it("falls back to the first project when the current selection vanished", () => {
    expect(resolveSelectedProjectId("missing", projects)).toBe("p1");
  });

  it("clears selection when there are no projects", () => {
    expect(resolveSelectedProjectId("p1", [])).toBeNull();
  });

  it("resolves a selected project path without leaking project lookup logic into UI code", () => {
    expect(projectPathById(projects, "p2")).toBe("/work/two");
    expect(projectPathById(projects, "missing")).toBe("");
  });
});
