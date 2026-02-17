"use client";

import { PrimeReactProvider } from "primereact/api";

export function PrimeProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrimeReactProvider
      value={{
        ripple: true,
        inputStyle: "outlined",
        appendTo: "self",
      }}
    >
      {children}
    </PrimeReactProvider>
  );
}

