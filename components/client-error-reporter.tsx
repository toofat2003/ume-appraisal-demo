"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/client";

export default function ClientErrorReporter() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      void reportClientError({
        source: "window.error",
        message: event.message || "Unhandled browser error",
        errorName: event.error?.name || null,
        stack: event.error?.stack || null,
        metadata: {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
        },
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason =
        event.reason instanceof Error
          ? event.reason
          : new Error(
              typeof event.reason === "string"
                ? event.reason
                : "Unhandled promise rejection"
            );

      void reportClientError({
        source: "window.unhandledrejection",
        message: reason.message,
        errorName: reason.name,
        stack: reason.stack || null,
        metadata: {
          rejectionType:
            event.reason && typeof event.reason === "object"
              ? event.reason.constructor?.name || "object"
              : typeof event.reason,
        },
      });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
