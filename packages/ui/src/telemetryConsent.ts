import { useCallback, useEffect, useState } from "react";

export type ConsentStatus = "unasked" | "granted" | "declined";
export type TelemetryConsent = Record<string, ConsentStatus>;

export function normalizeTelemetryConsent(raw: unknown): TelemetryConsent {
  if (typeof raw !== "object" || raw === null) return {};
  const result: TelemetryConsent = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === "unasked" || value === "granted" || value === "declined") result[key] = value;
  }
  return result;
}

export function useTelemetryConsent(key: string) {
  const [consent, setConsent] = useState<TelemetryConsent | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.quireDesktop.loadTelemetryConsent().then((raw) => {
      if (!cancelled) setConsent(normalizeTelemetryConsent(raw));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setStatus = useCallback(
    (status: ConsentStatus) => {
      setConsent((prev) => {
        const next = { ...(prev ?? {}), [key]: status };
        window.quireDesktop.saveTelemetryConsent(next);
        return next;
      });
    },
    [key],
  );

  return {
    status: consent === null ? null : (consent[key] ?? "unasked"),
    grant: () => setStatus("granted"),
    decline: () => setStatus("declined"),
  };
}
