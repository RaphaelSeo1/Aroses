import { NextResponse } from "next/server";
import { generateBoardIllustration } from "@/lib/mentored/board-image";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;

type Body = {
  title?: unknown;
  brief?: unknown;
  labels?: unknown;
};

function asText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = asText(body.title, 120);
  const brief = asText(body.brief, 700);
  if (title.length < 2 || brief.length < 20) {
    return NextResponse.json({ error: "Need a concept and a picture description." }, { status: 400 });
  }
  const labels = Array.isArray(body.labels)
    ? body.labels
        .map((label) => asText(label, 42))
        .filter((label) => label.length > 0)
        .slice(0, 6)
    : [];

  try {
    const image = await generateBoardIllustration({ title, brief, labels });
    return NextResponse.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not draw the board.";
    console.error("[mentored/board-image]", message);
    return NextResponse.json({ error: "Could not draw the board." }, { status: 502 });
  }
}
