-- LEGACY PROTOTYPE SCHEMA - DO NOT APPLY TO A NEW OR PRODUCTION DATABASE.
-- This one-shot file is retained only to describe the current MVP tables.
-- The approved target is database_schema.md and must be implemented as
-- versioned Supabase migrations under PAI-004.
-- ==========================================

-- 1. Custom Types
CREATE TYPE goal_status AS ENUM ('pending', 'in_progress', 'completed');

-- 2. Trigger Function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 3. Transcripts Table (Raw Brain Dumps)
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ -- Soft delete
);

CREATE TRIGGER update_transcripts_updated_at
    BEFORE UPDATE ON transcripts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Visions Table
CREATE TABLE IF NOT EXISTS visions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_visions_updated_at
    BEFORE UPDATE ON visions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Yearly Goals Table
CREATE TABLE IF NOT EXISTS yearly_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vision_id UUID NOT NULL REFERENCES visions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status goal_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_yearly_goals_updated_at
    BEFORE UPDATE ON yearly_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Quarterly Goals Table
CREATE TABLE IF NOT EXISTS quarterly_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    yearly_id UUID NOT NULL REFERENCES yearly_goals(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status goal_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_quarterly_goals_updated_at
    BEFORE UPDATE ON quarterly_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Monthly Tasks Table
CREATE TABLE IF NOT EXISTS monthly_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    quarterly_id UUID NOT NULL REFERENCES quarterly_goals(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status goal_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_monthly_tasks_updated_at
    BEFORE UPDATE ON monthly_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Weekly Actions Table
CREATE TABLE IF NOT EXISTS weekly_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    monthly_id UUID NOT NULL REFERENCES monthly_tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    status goal_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TRIGGER update_weekly_actions_updated_at
    BEFORE UPDATE ON weekly_actions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 9. Enable Row Level Security (RLS) on all tables (Issue #17)
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE visions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yearly_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_actions ENABLE ROW LEVEL SECURITY;

-- 10. Create RLS Policies (Users can only see/modify their own data)
CREATE POLICY "Users can manage their own transcripts" ON transcripts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own visions" ON visions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own yearly_goals" ON yearly_goals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own quarterly_goals" ON quarterly_goals FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own monthly_tasks" ON monthly_tasks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own weekly_actions" ON weekly_actions FOR ALL USING (auth.uid() = user_id);
