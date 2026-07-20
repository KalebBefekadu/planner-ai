"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("App Error:", error);
  }, [error]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      gap: "1rem",
      padding: "2rem"
    }}>
      <h2 style={{ fontSize: "1.5rem", color: "var(--danger)", fontWeight: 600 }}>Something went wrong!</h2>
      <p style={{ color: "var(--text-secondary)" }}>An unexpected error occurred in the application.</p>
      <button
        className="btn-primary"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
