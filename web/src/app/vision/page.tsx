"use client";

import { useState } from "react";

export default function VisionPage() {
  const [vision, setVision] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  // Mocking the AI Socratic Questions
  const mockQuestions = [
    "What specific feeling are you chasing with this vision?",
    "If you achieved this tomorrow, what would you immediately change about your daily routine?",
  ];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "2rem", height: "100%" }}>
      {!isExpanded && (
        <header>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.03em" }}>Vision Casting</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
            Define the overarching direction of your life. Let the AI prompt you.
          </p>
        </header>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ 
              background: "none", 
              border: "none", 
              color: "var(--accent)", 
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.9rem"
            }}
          >
            {isExpanded ? "Collapse View" : "Expand to Focus"}
          </button>
        </div>
        
        <textarea
          className="input-field"
          placeholder="I want to build a life where..."
          value={vision}
          onChange={(e) => setVision(e.target.value)}
          style={{ 
            flex: 1, 
            minHeight: isExpanded ? "60vh" : "200px", 
            resize: "none",
            fontSize: "1.15rem",
            lineHeight: 1.6,
            transition: "min-height 0.3s ease"
          }}
        />
      </div>

      {!isExpanded && (
        <div className="glass" style={{ 
          padding: "1.5rem", 
          borderRadius: "16px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface)"
        }}>
          <h3 style={{ fontSize: "1rem", color: "var(--accent)", marginBottom: "1rem", fontWeight: 600 }}>
            Strategic Coach ✦
          </h3>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {mockQuestions.map((q, i) => (
              <li key={i} style={{ 
                padding: "1rem", 
                backgroundColor: "var(--surface-hover)", 
                borderRadius: "8px",
                fontSize: "0.95rem",
                color: "var(--text-primary)"
              }}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
