import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditStudyMaterial } from "@/lib/collaboration/permissions";

const MATERIAL_ID = "123e4567-e89b-42d3-a456-426614174000";
const COURSE_ID = "123e4567-e89b-42d3-a456-426614174001";

test("material owners are authorized to edit module review questions", async () => {
  const supabase = fakePermissionClient({
    courseOwnerId: "owner",
    collaborator: null,
  });
  assert.equal(
    await canEditStudyMaterial(supabase, "owner", MATERIAL_ID),
    true
  );
});

test("accepted editors are authorized but viewers and outsiders are not", async () => {
  const editor = fakePermissionClient({
    courseOwnerId: "owner",
    collaborator: { role: "editor", status: "accepted" },
  });
  const viewer = fakePermissionClient({
    courseOwnerId: "owner",
    collaborator: { role: "viewer", status: "accepted" },
  });
  const outsider = fakePermissionClient({
    courseOwnerId: "owner",
    collaborator: null,
  });

  assert.equal(await canEditStudyMaterial(editor, "editor", MATERIAL_ID), true);
  assert.equal(await canEditStudyMaterial(viewer, "viewer", MATERIAL_ID), false);
  assert.equal(
    await canEditStudyMaterial(outsider, "outsider", MATERIAL_ID),
    false
  );
});

function fakePermissionClient({
  courseOwnerId,
  collaborator,
}: {
  courseOwnerId: string;
  collaborator: { role: "editor" | "viewer"; status: "accepted" } | null;
}): SupabaseClient {
  return {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async maybeSingle() {
          if (table === "study_materials") {
            return { data: { course_id: COURSE_ID }, error: null };
          }
          if (table === "courses") {
            return {
              data: { id: COURSE_ID, user_id: courseOwnerId },
              error: null,
            };
          }
          if (table === "course_collaborators") {
            return { data: collaborator, error: null };
          }
          return { data: null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}
