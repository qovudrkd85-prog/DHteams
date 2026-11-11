import type { Project } from "@/lib/types";

type ListedProject = Pick<Project, "id" | "name" | "code" | "description">;

/** True when two project lists show the same rows in the same order (so the old array can be kept). */
export function sameProjects(a: readonly ListedProject[], b: readonly ListedProject[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return p.id === q.id && p.name === q.name && p.code === q.code && p.description === q.description;
  });
}
