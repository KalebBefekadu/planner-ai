# Product Requirements Document (PRD)

## 1. Vision & Core Objective
A purpose-built, personal life planning application designed to reduce the friction of daily and weekly documentation through a voice-first interface, enforcing a structured goal hierarchy.

## 2. MVP Scope (Version 1.0)
The MVP will focus strictly on speed, cross-device accessibility, and the core "brain dump" experience. 
- **Platform:** Web Application (Next.js + Supabase) to allow immediate access on both desktop and mobile browsers.
- **User Interface:** "Simple Mode" only. A minimal, highly guided interface focusing purely on the next immediate action and voice-recording prompt. Data visualizations are excluded unless absolutely essential.
- **Hierarchy Cascade:** A single, fixed cascade option: `Vision -> Yearly Goals -> Quarterly Goals -> Monthly Tasks -> Weekly (Goals & Tasks)`. 
- **Authentication:** Standard email/password authentication using Supabase.
- **Data Synchronization:** Real-time sync via Supabase (standard database security; advanced end-to-end encryption is deferred to later versions).

## 3. Core Features (MVP)
* **Voice-to-Text Transcription:** A simple UI allowing the user to record daily/weekly progress. The system will transcribe the audio (via OpenAI Whisper) and save it as raw text. For the MVP, the AI does *not* automatically parse and check off tasks; it simply captures the brain dump.
* **Socratic Vision Casting (Basic):** A dual-interface allowing the user to expand a text area to focus solely on writing their vision, with AI-driven Socratic questions displayed at the bottom of the screen to guide their thoughts.

## 4. Final Product / Future Scope (Post-MVP)
- **Local-first Desktop Client:** Wrapping the web app in Tauri for true offline capabilities.
- **Advanced Mode UI:** Relational database UI, custom query building, and advanced analytics dashboards.
- **Custom Hierarchies:** Allowing users to create custom node tiers (e.g., 5-Year Plan, Daily Habits).
- **Proactive AI Coach:** AI automatically processes transcripts to update tasks, suggest blockers, and acts as an aggressive "SMART Goal Enforcer".
- **End-to-End Encryption:** For absolute data privacy.
