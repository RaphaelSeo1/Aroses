import type { StudyChatOption } from "@/types/study-chat";
import type { ModuleMatch } from "@/lib/study-chat-nav";

export function formatNavigationOptionLabel(args: {
  match: ModuleMatch;
  uploadLabel: string;
  multiUpload: boolean;
  currentMaterialId: string;
  currentModuleId?: number;
}): string {
  const { match, uploadLabel, multiUpload, currentMaterialId, currentModuleId } =
    args;
  const here =
    match.materialId === currentMaterialId &&
    typeof currentModuleId === "number" &&
    match.moduleId === currentModuleId;
  const uploadSuffix =
    multiUpload && uploadLabel ? ` · ${uploadLabel}` : "";
  const hereSuffix = here ? " (here)" : "";
  return `Module ${match.moduleId}: ${match.moduleTitle}${uploadSuffix}${hereSuffix}`;
}

export function buildNavigationOptions(args: {
  matches: ModuleMatch[];
  materialLabels: Map<string, string>;
  currentMaterialId: string;
  currentModuleId?: number;
  limit?: number;
}): StudyChatOption[] {
  const multiUpload = args.materialLabels.size > 1;
  return args.matches.slice(0, args.limit ?? 6).map((match, i) => {
    const uploadLabel =
      args.materialLabels.get(match.materialId) ?? "Course upload";
    return {
      id: `nav-${match.materialId}-${match.moduleId}-${i}`,
      label: formatNavigationOptionLabel({
        match,
        uploadLabel,
        multiUpload,
        currentMaterialId: args.currentMaterialId,
        currentModuleId: args.currentModuleId,
      }),
      description: match.reason,
      action: {
        type: "navigate_to_location",
        materialId: match.materialId,
        moduleId: match.moduleId,
        reason: match.reason,
      },
    };
  });
}
