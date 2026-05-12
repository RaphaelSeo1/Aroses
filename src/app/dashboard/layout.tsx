import type { ReactNode } from "react";

/** Admin nav context lives in root `AppAdminNavGate`; this layout is a stable route group shell. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
