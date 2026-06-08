// Smart Cellar — Stripe Checkout Session
// /api/create-checkout-session.js
// Vercel serverless function, mirrors Smart Kitchen pattern
// RG Digital Labs, LLC · June 2026

import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Smart Cellar Stripe Price IDs — confirmed June 2026
// Solo     = standalone Smart Cellar subscription
// Cellar+  = Smart Cellar Module (add-on / multi-device tier)
const PRICE_IDS = {
  cellar_solo_monthly:   'price_1Tg5EDPPshJUzsYXJAGsR1ax',   // Smart Cellar Monthly
  cellar_solo_annual:    'price_1Tg5FFPPshJUzsYXBfpFL8qr',   // Smart Cellar Annual
  cellar_family_monthly: 'price_1Tg5FuPPshJUzsYXh7cO2mfp',  // Smart Cellar Module Monthly
  cellar_family_annual:  'price_1Tg5GHPPshJUzsYXYlpfzqTO',  // Smart Cellar Module Annual
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
