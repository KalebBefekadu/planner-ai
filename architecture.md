# System Architecture

## 1. MVP Architecture (Web-First)
To prioritize speed of deployment and multi-device access, the MVP utilizes a standard modern web stack:
* **Frontend:** Next.js (App Router) using React. 
* **Backend / Database:** Supabase (PostgreSQL). Supabase provides real-time database capabilities, row-level security, and authentication.
* **Hosting:** Vercel (or similar platform) for immediate deployment.

## 2. Data Flow
1. Client (Browser) interacts with Next.js frontend.
2. Next.js server actions / API routes securely handle AI requests (e.g., calling OpenAI Whisper API).
3. Client directly interacts with Supabase via Supabase JS client for fetching and mutating planning data (Vision, Goals, Tasks), secured by Row Level Security (RLS).

## 3. Future Architecture (Local-First Desktop)
In the final product, the Next.js application will be wrapped in **Tauri**. 
- The Tauri app will run natively on desktop (Mac/Windows).
- It will read/write to the local filesystem (JSON/SQLite) for zero-latency, offline-first usage.
- A "Sync Engine" will securely relay encrypted diffs back to the Supabase cloud to maintain state across devices.
