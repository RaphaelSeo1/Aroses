"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ModuleQuiz } from "@/components/ModuleQuiz";
import {
  buildCourseWideQuizSession,
  type CourseWideQuizEntry,
} from "@/lib/quiz-session";

export function CourseMixQuizClient({
  entries,
  fallbackMaterialId,
  fallbackModuleId,
  returnHref,
}: {
  entries: CourseWideQuizEntry[];
  fallbackMaterialId: string;
  fallbackModuleId: number;
  returnHref: string;
}) {
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);

  const items = useMemo(
    () => buildCourseWideQuizSession(entries, epoch),
    [entries, epoch]
  );

  return (
    <ModuleQuiz
      key={epoch}
      materialId={fallbackMaterialId}
      moduleId={fallbackModuleId}
      items={items}
      shuffleEpoch={epoch}
      hasNextModule={false}
      mixedCourseReview
      onCompleteQuiz={async () => {
        router.push(returnHref);
      }}
    />
  );
}
