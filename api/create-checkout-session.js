// Smart Cellar — Stripe Checkout Session
// /api/create-checkout-session.js
// Vercel serverless function, mirrors Smart Kitchen pattern
// RG Digital Labs, LLC · June 2026

import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Smart Cellar Stripe Price IDs — create in Stripe dashboard and replace below
const PRICE_IDS = {
  cellar_solo_monthly:   'price_SMART_CELLAR_SOLO_MONTHLY',
  cellar_solo_annual:    'price_SMART_CELLAR_SOLO_ANNUAL',
  cellar_family_monthly: 'price_SMART_CELLAR_FAMILY_MONTHLY',
  cellar_family_annual:  'price_SMART_CELLAR_FAMILY_ANNUAL',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId, email, priceId, tier } = req.body

  if (!userId || !email || !priceId) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const stripePriceId = PRICE_IDS[priceId]
  if (!stripePriceId) {
    return res.status(400).json({ error: 'Invalid price ID: ' + priceId })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      metadata: { userId, tier },
      success_url: `${process.env.VITE_APP_URL}?subscription=success&tier=${tier}`,
      cancel_url: `${process.env.VITE_APP_URL}?subscription=cancelled`,
    })
    res.json({ url: session.url })
  } catch (err) {
    console.error('Stripe error:', err)
    res.status(500).json({ error: err.message })
  }
}
