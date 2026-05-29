import {
  contentTypeForUpload,
  detectIngestFormat,
} from "@/lib/study-ingest/formats";
import { buildIngestStoragePath } from "@/lib/study-ingest/path";

export function ingestStoragePathForFile(
  userId: string,
  file: File
): { storagePath: string; contentType: string } | null {
  const kind = detectIngestFormat(file.name, file.type);
  if (!kind) return null;
  const storagePath = buildIngestStoragePath(userId, file.name);
  if (!storagePath) return null;
  return {
    storagePath,
    contentType: contentTypeForUpload(file.name, kind),
  };
}
