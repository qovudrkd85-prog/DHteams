import { ProjectWorkspace } from "@/components/project-workspace";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  return <ProjectWorkspace projectId={id} />;
}
