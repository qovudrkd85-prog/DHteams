import { ProjectWorkspace } from "@/components/project-workspace";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const { view } = await props.searchParams;
  return <ProjectWorkspace key={`${id}:${view ?? ""}`} projectId={id} initialView={view === "schedule" ? "schedule" : undefined} />;
}
