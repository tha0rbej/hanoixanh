import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { STORAGE_KEYS } from "./data";
import type { ContactMessage, PollutionReport, VolunteerRegistration } from "./types";
import { useLocalStorageList } from "./useLocalStorageList";

interface AppDataValue {
  registrations: ReturnType<typeof useLocalStorageList<VolunteerRegistration>>;
  reports: ReturnType<typeof useLocalStorageList<PollutionReport>>;
  messages: ReturnType<typeof useLocalStorageList<ContactMessage>>;
  notify: (message: string) => void;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const registrations = useLocalStorageList<VolunteerRegistration>(STORAGE_KEYS.registrations);
  const reports = useLocalStorageList<PollutionReport>(STORAGE_KEYS.reports);
  const messages = useLocalStorageList<ContactMessage>(STORAGE_KEYS.messages);
  const [notice, setNotice] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const notify = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(""), 4500);
  }, []);
  const value = useMemo(() => ({ registrations, reports, messages, notify }), [registrations, reports, messages, notify]);
  return <AppDataContext.Provider value={value}>{children}{notice && <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-xl bg-gray-950 px-5 py-3 text-sm font-bold text-white shadow-2xl">{notice}</div>}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}
