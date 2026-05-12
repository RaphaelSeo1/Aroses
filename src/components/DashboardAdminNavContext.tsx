"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

type DashboardAdminNavValue = {
  adminHubHref?: string;
};

const DashboardAdminNavContext = createContext<
  DashboardAdminNavValue | undefined
>(undefined);

export function DashboardAdminNavProvider({
  adminHubHref,
  children,
}: {
  adminHubHref?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ adminHubHref }), [adminHubHref]);
  return (
    <DashboardAdminNavContext.Provider value={value}>
      {children}
    </DashboardAdminNavContext.Provider>
  );
}

export function useDashboardAdminNav(): DashboardAdminNavValue | undefined {
  return useContext(DashboardAdminNavContext);
}
