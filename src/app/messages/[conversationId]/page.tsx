import { notFound, redirect } from "next/navigation";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ conversationId: string }> };

export default async function ConversationPage({ params }: Props) {
  const { conversationId } = await params;
  if (!UUID_RE.test(conversationId)) notFound();

  redirect(
    `/dashboard/profile?tab=messages&conversation=${encodeURIComponent(conversationId)}`
  );
}
