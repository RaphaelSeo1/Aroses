"use client";

import { useEffect, useState } from "react";
import { CourseLearningCard } from "@/components/progress/CourseLearningCard";
import { useDismissStudyCourse } from "@/components/progress/useDismissStudyCourse";
import type { CourseLearningSummary } from "@/lib/learning-stats";

export function ProgressCourseList({
  courses,
}: {
  courses: CourseLearningSummary[];
}) {
  const [items, setItems] = useState(courses);
  const { requestDismiss, dismissDialog, error } = useDismissStudyCourse({
    onDismissed: (courseId) => {
      setItems((prev) => prev.filter((c) => c.courseId !== courseId));
    },
  });

  useEffect(() => {
    setItems(courses);
  }, [courses]);

  if (items.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-zinc-200/90 bg-zinc-50/60 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          No courses in your study list
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Open a course from Explore or your workspace to start studying again.
        </p>
      </div>
    );
  }

  return (
    <>
      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {items.map((c) => (
          <li key={c.courseId} className="flex">
            <CourseLearningCard
              course={c}
              onRemove={() =>
                requestDismiss({
                  courseId: c.courseId,
                  title: c.title,
                  isExploreLearner: c.isExploreLearner,
                })
              }
            />
          </li>
        ))}
      </ul>
      {dismissDialog}
    </>
  );
}
