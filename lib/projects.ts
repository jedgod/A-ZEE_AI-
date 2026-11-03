// Projects group conversations in this browser. Conversations saved before
// projects existed have no projectId and belong to the default project.

export type Project = { id: string; name: string };
type Grouped<T> = { project: Project; items: T[] };

export const DEFAULT_PROJECT: Project = { id: "general", name: "General" };
export const MAX_PROJECTS = 20;
export const MAX_PROJECT_NAME = 40;

export function parseProjects(raw: unknown): Project[] {
  const list = Array.isArray(raw) ? raw.filter((p): p is Project =>
    p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim() !== "") : [];
  const rest = list.filter(p => p.id !== DEFAULT_PROJECT.id).slice(0, MAX_PROJECTS - 1);
  return [DEFAULT_PROJECT, ...rest];
}

export function addProject(projects: Project[], name: string, id: string): { projects: Project[]; project: Project } | { error: string } {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, MAX_PROJECT_NAME);
  if (!clean) return { error: "Enter a project name." };
  const existing = projects.find(p => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return { projects, project: existing };
  if (projects.length >= MAX_PROJECTS) return { error: `You can have up to ${MAX_PROJECTS} projects.` };
  const project = { id, name: clean };
  return { projects: [...projects, project], project };
}

export const projectOf = <T extends { projectId?: string }>(item: T | undefined, projects: Project[]): Project =>
  projects.find(p => p.id === item?.projectId) || DEFAULT_PROJECT;

export function groupByProject<T extends { projectId?: string }>(items: T[], projects: Project[]): Grouped<T>[] {
  return projects
    .map(project => ({ project, items: items.filter(i => projectOf(i, projects).id === project.id) }))
    .filter(group => group.items.length > 0);
}
