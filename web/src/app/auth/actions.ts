'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export async function login(formData: FormData) {
  const supabase = await createClient()
  
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    redirect(`/login?message=${error.message}`)
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signup(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Use the Admin API to bypass the internal rate-limited email sender
  const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
  })

  if (error) {
    redirect(`/signup?message=${error.message}`)
  }

  // Use Resend to actually send the generated confirmation link
  const resend = new Resend(process.env.RESEND_API_KEY)
  const actionLink = data.properties?.action_link

  if (actionLink) {
    const { error: resendError } = await resend.emails.send({
      from: 'Planner AI <onboarding@resend.dev>',
      to: [email],
      subject: 'Confirm your signup to Planner AI',
      html: `<p>Welcome to Planner AI!</p><p>Click the link below to confirm your account:</p><p><a href="${actionLink}">Confirm Email</a></p>`
    })

    if (resendError) {
      console.error(resendError)
      redirect(`/signup?message=Failed to send email via Resend`)
    }
  }

  revalidatePath('/', 'layout')
  redirect('/?message=Check your email to verify your account')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
