"use client";

import { createContext, useContext, useState } from "react";
import { type DataRow, type DatasetKind } from "@/lib/uploads";

type Dataset = { rows: DataRow[]; filename: string };
type SessionData = Record<DatasetKind, Dataset>;
type SessionContextValue = {
  data: SessionData;
  replaceDataset: (kind: DatasetKind, rows: DataRow[], filename: string) => void;
  clearDataset: (kind: DatasetKind) => void;
};

function emptyDataset(): Dataset { return { rows: [], filename: "" }; }
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<SessionData>(() => ({ pilots: emptyDataset(), vehicles: emptyDataset(), locations: emptyDataset(), customers: emptyDataset(), existing: emptyDataset() }));
  function replaceDataset(kind: DatasetKind, rows: DataRow[], filename: string) {
    setData((current) => ({ ...current, [kind]: { rows, filename } }));
  }
  function clearDataset(kind: DatasetKind) {
    setData((current) => ({ ...current, [kind]: emptyDataset() }));
  }
  return <SessionContext.Provider value={{ data, replaceDataset, clearDataset }}>{children}</SessionContext.Provider>;
}

export function useSessionData() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Session data requires the workspace provider.");
  return context;
}
