import { describe, it, expect } from "vitest";
import { addProject, DEFAULT_PROJECT, groupByProject, MAX_PROJECTS, parseProjects, projectOf } from "@/lib/projects";

describe("projects", () => {
  it("always includes the default project first and drops invalid entries", () => {
    expect(parseProjects(null)).toEqual([DEFAULT_PROJECT]);
    expect(parseProjects([{ id: "a", name: "Alpha" }, { id: 1 }, { id: "general", name: "Renamed" }, { id: "b", name: " " }]))
      .toEqual([DEFAULT_PROJECT, { id: "a", name: "Alpha" }]);
  });

  it("adds trimmed, de-duplicated projects within the limit", () => {
    const first = addProject([DEFAULT_PROJECT], "  Client   site ", "p1");
    expect(first).toEqual({ projects: [DEFAULT_PROJECT, { id: "p1", name: "Client site" }], project: { id: "p1", name: "Client site" } });
    const again = addProject("projects" in first ? first.projects : [], "client SITE", "p2");
    expect("project" in again && again.project.id).toBe("p1");
    expect(addProject([DEFAULT_PROJECT], "   ", "x")).toEqual({ error: "Enter a project name." });
    const full = Array.from({ length: MAX_PROJECTS }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(addProject(full, "One more", "z")).toHaveProperty("error");
  });

  it("groups conversations by project, treating unknown or missing ids as the default", () => {
    const projects = [DEFAULT_PROJECT, { id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
    const items = [{ id: 1, projectId: "a" }, { id: 2 }, { id: 3, projectId: "gone" }];
    expect(projectOf(items[0], projects).name).toBe("Alpha");
    expect(groupByProject(items, projects).map(g => [g.project.name, g.items.map(i => i.id)]))
      .toEqual([["General", [2, 3]], ["Alpha", [1]]]);
  });
});
