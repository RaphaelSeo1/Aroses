import { NextResponse } from "next/server";

/** Course creation is off while the builder is replaced. */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Course creation is turned off while the builder is replaced. Existing courses are unchanged.",
    },
    { status: 410 }
  );
}
