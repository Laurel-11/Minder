import { redirect } from "next/navigation";

/** Old approval links still work: they now open the full purchase page. */
export default async function ApproveRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/purchases/${id}`);
}
