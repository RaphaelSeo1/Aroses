import { createClient } from "@/lib/supabase/server";
import {
  refreshDiscussionSummary,
  runTutorTurnStream,
} from "@/lib/ai/tutor-session";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
} from "@/types/tutor-session";

/**
 * POST /api/tutor-session/[sessionId]/turn-stream
 *
 * One assistant turn, streamed as Server-Sent Events.
 *
 * Body: { utterance: string }
 *
 * SSE event stream:
 *   - event: text   data: { delta }
 *   - event: meta   data: { intent, imageRequest }
 *   - event: done   data: { ok: true }
 *
 * Persistence:
 *   - The student's utterance is appended to `conversation_transcript`
 *     BEFORE we start streaming so the row is durable even if the
 *     stream gets cut.
 *   - Rose's full reply is appended AFTER the stream completes.
 *   - Every 6 turns we refresh `discussion_summary` (cheap Haiku
 *     call) so the next prompt doesn't carry the whole history.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return new Response(JSON.stringify({ error: "Invalid session id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { utterance?: unknown };
  try {
    body = (await request.json()) as { utterance?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const utterance =
    typeof body.utterance === "string" ? body.utterance.trim() : "";
  if (utterance.length === 0) {
    return new Response(JSON.stringify({ error: "Empty utterance" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select(
      "id, user_id, status, topic, mode_tag, reference_summary, discussion_summary, conversation_transcript"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (sessionRow.status !== "active") {
    return new Response(JSON.stringify({ error: "Session has ended" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history: TutorSessionMessage[] = Array.isArray(
    sessionRow.conversation_transcript
  )
    ? (sessionRow.conversation_transcript as TutorSessionMessage[])
    : [];

  // 1. Append the student utterance to the transcript IMMEDIATELY so
  //    crashes mid-stream still record what they said.
  const userMessage: TutorSessionMessage = {
    role: "user",
    content: utterance,
    ts: Date.now(),
  };
  const transcriptAfterUser = [...history, userMessage];
  await supabase
    .from("tutor_sessions")
    .update({
      conversation_transcript: transcriptAfterUser,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      let assistantText = "";
      try {
        for await (const evt of runTutorTurnStream({
          modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
          topic: sessionRow.topic ?? "",
          referenceSummary: sessionRow.reference_summary ?? "",
          discussionSummary: sessionRow.discussion_summary ?? "",
          history,
          studentUtterance: utterance,
        })) {
          if (evt.type === "text") {
            assistantText += evt.delta;
            send("text", { delta: evt.delta });
          } else if (evt.type === "meta") {
            send("meta", {
              intent: evt.intent,
              imageRequest: evt.imageRequest,
            });
          }
        }

        // 2. Append assistant turn. Then schedule a summary refresh
        //    every 6 messages — cheap Haiku call, doesn't block the
        //    response back to the client.
        const assistantMessage: TutorSessionMessage = {
          role: "assistant",
          content: assistantText.trim() || "(no response)",
          ts: Date.now(),
        };
        const transcriptAfterAssistant = [
          ...transcriptAfterUser,
          assistantMessage,
        ];

        const totalMessages = transcriptAfterAssistant.length;
        let nextDiscussionSummary = sessionRow.discussion_summary ?? "";
        if (totalMessages % 6 === 0) {
          try {
            const recent = transcriptAfterAssistant.slice(-6);
            nextDiscussionSummary = await refreshDiscussionSummary({
              previousSummary: nextDiscussionSummary,
              recentMessages: recent,
            });
          } catch (e) {
            console.error("[tutor turn-stream summary]", e);
          }
        }

        await supabase
          .from("tutor_sessions")
          .update({
            conversation_transcript: transcriptAfterAssistant,
            discussion_summary: nextDiscussionSummary,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId)
          .eq("user_id", user.id);

        send("done", { ok: true });
      } catch (e) {
        console.error("[tutor turn-stream]", e);
        send("error", { message: "stream failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
