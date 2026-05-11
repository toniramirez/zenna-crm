"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type FocusModeValue = {
  focused: boolean;
  setFocused: (v: boolean) => void;
  toggle: () => void;
};

const FocusModeContext = createContext<FocusModeValue | null>(null);

const STORAGE_KEY = "zenna.dashboard.focus";

export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focused, setFocusedState] = useState(false);

  // Hydrate from localStorage on mount. We accept a one-frame flash on the
  // very first load — the alternative (cookie + SSR) would couple this to
  // every server request.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setFocusedState(true);
    } catch {
      /* SSR / privacy mode — ignore */
    }
  }, []);

  const persist = (v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const setFocused = useCallback((v: boolean) => {
    setFocusedState(v);
    persist(v);
  }, []);

  const toggle = useCallback(() => {
    setFocusedState((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, []);

  return (
    <FocusModeContext.Provider value={{ focused, setFocused, toggle }}>
      {children}
    </FocusModeContext.Provider>
  );
}

export function useFocusMode() {
  const ctx = useContext(FocusModeContext);
  if (!ctx)
    throw new Error("useFocusMode must be used inside <FocusModeProvider>");
  return ctx;
}
