/** Client-safe caption filters (no Node canvas / fs). */

export function isJunkAssetCaption(caption: string): boolean {
  const c = caption.trim().toLowerCase();
  if (!c) return true;
  return (
    /placeholder|corrupted|broken image|checkbox|bullet symbol|icon array|missing character|tofu|☒|☐|envelope|stacked box|symbol column/.test(
      c
    ) ||
    /^page \d+$/i.test(caption.trim()) ||
    /repeated (checkbox|bullet)/i.test(caption)
  );
}

export function isTableLikeCaption(caption: string): boolean {
  const raw = caption.trim();
  const c = raw.toLowerCase();
  return (
    c.startsWith("table:") ||
    c.startsWith("table ") ||
    /^table\s*[\|:]/.test(c) ||
    /표\s*\d/.test(raw) ||
    c.includes("classification table") ||
    c.includes("comparison table") ||
    c.includes("drug classification table") ||
    c.includes("pharmacological classification table") ||
    c.includes("data grid") ||
    c.includes("data table") ||
    c.includes("premedication") ||
    c.includes("예비투약") ||
    c.includes("마취") ||
    /제\s*\d+\s*기/.test(raw) ||
    /진통기|흥분기/.test(raw) ||
    /작용부위/.test(raw) ||
    (/단계/.test(raw) && /작용부위|의식|호흡|진통|흥분/.test(raw)) ||
    /anesthesia stage/.test(c) ||
    (c.includes("matrix") && !c.includes("diagram") && !c.includes("flow"))
  );
}

export function isTextHeavyFigureCaption(caption: string): boolean {
  const raw = caption.trim();
  const c = raw.toLowerCase();
  return (
    /bar chart|distribution across categories|across multiple categor|stacked bar|vertical line chart|grid of (checkbox|bullet|icon)|category column|drug list only|drug names only|envelope icon|icon comparison|symbol comparison|checkbox grid|bullet list only|text block only|slide title bar|page footer|header bar only|comparison of drug names|patient in bed|hospital bed photo|increased effect.*decreased effect text|kidney filtration|glomerulus diagram|tubule reabsorption|filtration mechanism diagram|cranial nerve.*spinal nerve table|repeated checkbox|repeated bullet|hierarchical organization|branching structure|organizational diagram|organogram|tree diagram|box diagram|flowchart|flow chart|neural connections and distribution|classification.*mechanism.*diagram/.test(
      c
    ) ||
    /분류.*작용.*메커니즘|약물의 분류|작용 메커니즘 다이어그램/.test(raw)
  );
}

export function shouldKeepFigureCaption(caption: string): boolean {
  const c = caption.trim();
  if (c.length < 3) return false;
  if (isJunkAssetCaption(c)) return false;
  if (isTableLikeCaption(c)) return false;
  if (isTextHeavyFigureCaption(c)) return false;
  return true;
}
