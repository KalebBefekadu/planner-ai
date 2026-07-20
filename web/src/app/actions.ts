'use server'

import { createClient } from '@/lib/supabase/server'
import { Database } from '@/types/supabase'

export async function getActiveVision() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch the most recent active vision
  const { data, error } = await supabase
    .from('visions')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
    console.error('Error fetching vision:', error)
    return null
  }

  return data
}

export async function getGoalsHierarchy() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const vision = await getActiveVision()
  if (!vision) return null

  // Fetch all goals/tasks/actions connected to this vision that aren't deleted
  const [yearly, quarterly, monthly, weekly] = await Promise.all([
    supabase.from('yearly_goals').select('*').eq('vision_id', vision.id).is('deleted_at', null).order('created_at', { ascending: true }),
    supabase.from('quarterly_goals').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
    supabase.from('monthly_tasks').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
    supabase.from('weekly_actions').select('*').is('deleted_at', null).order('created_at', { ascending: true }),
  ])

  // In a real production app, we would map these into a nested tree structure here or on the client.
  return {
    vision,
    yearly: yearly.data || [],
    quarterly: quarterly.data || [],
    monthly: monthly.data || [],
    weekly: weekly.data || []
  }
}

export async function getTranscripts(limit: number = 7) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching transcripts:', error)
    return []
  }

  return data
}

export async function saveTranscript(rawText: string) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('transcripts')
    .insert({
      user_id: user.id,
      raw_text: rawText
    })
    .select()
    .single()

  if (error) throw error
  return data
}
