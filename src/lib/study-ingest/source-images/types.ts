/** A figure extracted from an uploaded source file and hosted for lesson embed. */
export type IngestSourceImageRecord = {
  id: string;
  url: string;
  sourceFileName: string;
  /** Human label for alt text, e.g. "Slide 3" or "Page 2". */
  label: string;
  anchorType: "slide" | "page" | "document";
  /** 1-based slide/page index; 0 for whole-document images. */
  anchorIndex: number;
  mimeType: string;
};

export type RawSourceImage = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  label: string;
  anchorType: "slide" | "page" | "document";
  anchorIndex: number;
  sourceFileName: string;
};
