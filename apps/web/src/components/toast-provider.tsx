"use client";

import { createContext, useContext, useRef } from "react";
import { Toast } from "primereact/toast";

type ToastSeverity = "success" | "info" | "warn" | "error";

interface ToastMessage {
  severity: ToastSeverity;
  summary: string;
  detail?: string;
  life?: number;
}

interface ToastContextValue {
  show: (message: ToastMessage) => void;
}

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
});

export function useAppToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toastRef = useRef<Toast>(null);

  const show = (message: ToastMessage) => {
    toastRef.current?.show({
      severity: message.severity,
      summary: message.summary,
      detail: message.detail,
      life: message.life ?? 3000,
    });
  };

  return (
    <ToastContext value={{ show }}>
      <Toast ref={toastRef} />
      {children}
    </ToastContext>
  );
}
