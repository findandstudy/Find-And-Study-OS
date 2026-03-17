import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const STORAGE_KEY = "edcons_selected_season";
const currentYear = String(new Date().getFullYear());

export const SEASON_YEARS = Array.from({ length: 6 }, (_, i) =>
  String(new Date().getFullYear() - 2 + i)
);

type SeasonContextType = {
  season: string;
  setSeason: (s: string) => void;
};

const SeasonContext = createContext<SeasonContextType>({
  season: currentYear,
  setSeason: () => {},
});

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [season, setSeasonState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || currentYear;
    } catch {
      return currentYear;
    }
  });

  const setSeason = (s: string) => {
    setSeasonState(s);
    try {
      localStorage.setItem(STORAGE_KEY, s);
    } catch {}
  };

  return (
    <SeasonContext.Provider value={{ season, setSeason }}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason() {
  return useContext(SeasonContext);
}
