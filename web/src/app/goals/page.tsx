"use client";

export default function GoalsPage() {
  const cascade = [
    { tier: "Yearly", title: "Launch Planner AI & Gain 100 Users", status: "In Progress" },
    { tier: "Quarterly", title: "Complete Web App MVP", status: "On Track" },
    { tier: "Monthly", title: "Finish UI and Supabase Auth", status: "In Progress" },
    { tier: "Weekly", title: "Setup Next.js and basic Layouts", status: "Done" },
  ];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "2rem", height: "100%" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 700, marginBottom: "0.5rem", letterSpacing: "-0.03em" }}>Goal Hierarchy</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
            Your current active cascade.
          </p>
        </div>
        <button className="btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}>
          + Add Goal
        </button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1rem" }}>
        {cascade.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "1.5rem" }}>
            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center",
              width: "24px" 
            }}>
              <div style={{ 
                width: "16px", 
                height: "16px", 
                borderRadius: "50%", 
                backgroundColor: item.status === "Done" ? "var(--accent)" : "var(--surface)",
                border: item.status === "Done" ? "none" : "2px solid var(--border)",
                zIndex: 2,
                cursor: "pointer"
              }} />
              {i !== cascade.length - 1 && (
                <div style={{ 
                  flex: 1, 
                  width: "2px", 
                  backgroundColor: "var(--border)",
                  margin: "4px 0"
                }} />
              )}
            </div>
            
            <div className="glass" style={{ 
              flex: 1,
              padding: "1.25rem", 
              borderRadius: "12px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--surface)",
              marginBottom: i !== cascade.length - 1 ? "0" : "auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
              <div>
                <div style={{ fontSize: "0.85rem", color: "var(--accent)", fontWeight: 600, marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {item.tier}
                </div>
                <div style={{ fontSize: "1.1rem", fontWeight: 500, color: "var(--text-primary)" }}>
                  {item.title}
                </div>
              </div>
              
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {/* Explicit "Verify with AI" button instead of automatic ping */}
                {item.status !== "Done" && (
                  <button style={{
                    background: "var(--accent-glow)",
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    padding: "0.35rem 0.75rem",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    transition: "all 0.2s ease"
                  }}>
                    Verify with AI ✦
                  </button>
                )}
                <button style={{
                  background: "var(--surface-hover)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}>
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
