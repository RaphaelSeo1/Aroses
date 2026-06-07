export function pageTableKey(sourceFileName: string, pageNum: number): string {
  return `${sourceFileName.trim().toLowerCase()}:p${pageNum}`;
}

export function pageFigureCropKey(
  sourceFileName: string,
  pageNum: number,
  figureIndex: number
): string {
  return `${sourceFileName.trim().toLowerCase()}:p${pageNum}:f${figureIndex}`;
}

export function pageTableCropKey(
  sourceFileName: string,
  pageNum: number,
  tableIndex: number
): string {
  return `${sourceFileName.trim().toLowerCase()}:p${pageNum}:t${tableIndex}`;
}
