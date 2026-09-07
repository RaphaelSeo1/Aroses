export type SrsSessionQuery = {
  scope?: "module" | "personal" | "both";
  materialId?: string;
  materialIds?: string[];
  moduleId?: number;
  newLimit?: number;
  maxReviews?: number;
  cram?: boolean;
};

export function buildSrsSessionUrl({
  scope = "both",
  materialId,
  materialIds,
  moduleId,
  newLimit,
  maxReviews,
  cram = false,
}: SrsSessionQuery): string {
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (materialId) params.set("materialId", materialId);
  if (materialIds && materialIds.length > 0) {
    params.set("materialIds", materialIds.join(","));
  }
  if (typeof moduleId === "number") params.set("moduleId", String(moduleId));
  if (typeof newLimit === "number") params.set("newLimit", String(newLimit));
  if (typeof maxReviews === "number") {
    params.set("maxReviews", String(maxReviews));
  }
  if (cram) params.set("cram", "1");
  return `/api/srs/session?${params.toString()}`;
}
