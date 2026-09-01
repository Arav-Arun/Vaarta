import { SharedWorld } from "@/components/SharedWorld";

/** A world somebody published, reachable by its link. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedWorld worldId={id} />;
}
