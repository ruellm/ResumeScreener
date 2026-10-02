"use client";

import { createContext, useContext, useState } from "react";
import { Tabs } from "@/components/ui/tabs";

const ShowTabContext = createContext<(tab: string) => void>(() => {});

// Lets something inside a tab switch to another tab.
export function useShowTab() {
  return useContext(ShowTabContext);
}

export function JobTabs({
  initialTab,
  children,
}: {
  initialTab: string;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState(initialTab);

  function show(next: string) {
    setTab(next);
    // Keeps the address in step, so a reload opens the same tab. The other
    // parameters stay: the Dashboard tab keeps its filters there.
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `?${params}`);
  }

  return (
    <ShowTabContext.Provider value={show}>
      <Tabs value={tab} onValueChange={show}>
        {children}
      </Tabs>
    </ShowTabContext.Provider>
  );
}
