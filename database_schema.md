# Database Schema (MVP)

## 1. Node Hierarchy
The MVP will enforce a strict, single cascade:
`Vision -> Yearly -> Quarterly -> Monthly -> Weekly`

## 2. Relational Structure (Supabase PostgreSQL)
All tables utilize `deleted_at` for soft-deletes to prevent catastrophic accidental data loss.

* **Users Table:** Standard Supabase Auth table (`auth.users`).
* **Visions Table:** `id`, `user_id`, `content`, `created_at`, `updated_at`, `deleted_at`.
* **Yearly Goals Table:** `id`, `user_id`, `vision_id` (FK), `content`, `status`, `created_at`, `deleted_at`.
* **Quarterly Goals Table:** `id`, `user_id`, `yearly_id` (FK), `content`, `status`, `created_at`, `deleted_at`.
* **Monthly Tasks Table:** `id`, `user_id`, `quarterly_id` (FK), `content`, `status`, `created_at`, `deleted_at`.
* **Weekly Actions Table:** `id`, `user_id`, `monthly_id` (FK), `content`, `status`, `created_at`, `deleted_at`.
* **Transcripts Table:** `id`, `user_id`, `raw_text`, `date`, `created_at`, `deleted_at`. Used for raw daily/weekly dumps.

*(Note: In the final product, this strict relational structure will be abstracted into a flexible node/edge system to support Custom Cascades, but for the MVP, standard foreign keys will ensure speed of development.)*
