# Project Blueprint: Voice-First Life Operating System

## 1. Executive Summary

A purpose-built, personal life planning application designed to replace a mature, multi-platform system. The core objective is to drastically reduce the friction of daily and weekly documentation through an intelligent, voice-first interface while enforcing a structured goal hierarchy. Built with a decoupled, local-first architecture, the application is designed to be highly effective and easy to maintain for personal use, with the scalability required for future productization.

## 2. Tiered User Experience (Simple vs. Advanced)

To accommodate different cognitive loads and user types, the application will feature a bifurcated UI/UX design controlled by a global state toggle.

* **Simple Mode:** A highly guided, minimalist interface. Features are stripped back to focus purely on the next immediate action and the voice-recording prompt. Complex data visualization, metadata, and backend schema settings are hidden to reduce overwhelm.
* **Advanced Mode:** Designed for technical users and deep planners. Exposes the full relational database UI, custom query building, advanced AI prompt tuning, and detailed analytics dashboards for granular progress tracking.

## 3. Dynamic Data Architecture (Customizable Hierarchies)

Recognizing that planning styles differ, the application will not force a rigid relational schema. Instead, the backend will support a customizable node-based hierarchy. Users can configure their preferred data cascade during onboarding:

* **Deep Cascade (Default):** Vision -> Yearly Goals -> Quarterly Goals -> Monthly Tasks -> Weekly Tasks.
* **Lean Cascade:** Yearly Goals -> Quarterly Goals -> Weekly Tasks.
* **Custom Cascade:** Users can toggle specific intermediary tiers (like "Monthly") on or off without breaking the overarching relational links between the Vision and the Weekly actions.

## 4. Core Features & The AI "Strategic Coach"

The application utilizes an intelligence layer not just for data entry, but to actively guide the planning process.

* **Frictionless Voice-to-Text:** Built on the OpenAI Whisper API. The user records weekly reviews and daily progress via a simple UI. Whisper handles all transcription and natural punctuation, completely removing the need for manual data entry.
* **Socratic Vision Casting:** During the Vision phase, the LLM acts as an interviewer, asking imaginative and probing questions to help define long-term goals clearly.
* **SMART Goal Enforcer:** When establishing Yearly, Quarterly, and Weekly goals, the AI intercepts vague inputs and suggests rewritten, highly specific, and measurable action items.
* **Automated Progress Analyzer:** The LLM consumes the raw voice transcripts, extracting blockers and completed tasks. By the time the dedicated monthly planning and progress check occurs on the last Sunday of the month, the AI has already cross-referenced the preceding 30 days of voice notes against the active Quarterly goals to highlight drift and output strategic adjustments.

## 5. Technical Architecture (The Local-First Model)

To ensure absolute data ownership, zero latency, and offline functionality, the system adopts a local-first architecture.

* **The Desktop Client (Primary Engine):** Built using a framework like Tauri wrapping a Next.js/React frontend. This setup provides native permissions to read and write data directly to the local hard drive as plain text or JSON files, treating a local directory as the primary database.
* **The Sync Engine (The Bridge):** A cloud database (like Supabase) acts strictly as a background relay. When a file is edited locally, the application encrypts the changes and pushes them to the cloud relay.
* **The Mobile Client (PWA):** A Progressive Web App designed specifically for quick mobile voice capture. It pulls the latest encrypted files from the cloud relay, caches them locally on the phone using IndexedDB, and merges any offline edits automatically once a connection is re-established.
