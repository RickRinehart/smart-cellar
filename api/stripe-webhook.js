// Smart Cellar — Stripe Webhook Handler
// /api/stripe-webhook.js
// Updates Supabase profiles table on subscription events
// RG Digital Labs, LLC · June 2026

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role for server-side writes
)

// Webhook secret from Stripe dashboard
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return res.status(400).json({ error: 'Webhook signature verification failed' })
  }

  const session = event.data.object

  switch (event.type) {
    case 'checkout.session.completed': {
      const { userId, tier } = session.metadata || {}
      if (userId) {
        await supabase.from('profiles').update({
          tier,
          subscription_status: 'active',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
        }).eq('id', userId)
      }
      break
    }

    case 'customer.subscription.deleted': {
      // Find user by stripe_subscription_id and downgrade
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_subscription_id', session.id)
        .single()
      if (profile) {
        await supabase.from('profiles').update({
          subscription_status: 'cancelled',
          tier: 'free',
        }).eq('id', profile.id)
      }
      break
    }

    case 'invoice.payment_failed': {
      // Find user and flag as past_due
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', session.customer)
        .single()
      if (profile) {
        await supabase.from('profiles').update({
          subscription_status: 'past_due',
        }).eq('id', profile.id)
      }
      break
    }
  }

  res.json({ received: true })
}

export const config = {
  api: { bodyParser: false }  // Stripe needs raw body for signature verification
}
