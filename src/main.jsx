// Smart Cellar — Entry Point
// Mirrors Smart Kitchen main.jsx pattern exactly (auth shell, trial, tier gating)
// RG Digital Labs, LLC · June 2026

import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {
  supabase,
  SC_KEYS,
  getUserProfile,
  trialDaysRemaining,
  markTouchpoint,
  loadCloudData,
  saveCloudData,
  setTrialStartDate,
} from './supabaseClient'
import './App.css'

// -- Admin bypass (shared with Smart Kitchen) ----------------------------------
const ADMIN_EMAILS = ['thesmartkitchenapp@gmail.com', 'michiganrvvacations@gmail.com']

// -- Inline Auth Modal (standalone, no cross-app import) -----------------------
function AuthModal({ onClose, onSuccess, initialMode = 'signup' }) {
  const [mode, setMode]         = useState(initialMode)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')

  const C = {
    bg:       'var(--sc-card)',
    surface:  'var(--sc-surface)',
    border:   'var(--sc-border)',
    text:     'var(--sc-text)',
    muted:    'var(--sc-muted)',
    burgundy: 'var(--sc-burgundy)',
    gold:     'var(--sc-gold)',
  }
  const FB = "'DM Sans', sans-serif"
  const FD = "'Cormorant Garamond', serif"

  async function handleSignUp() {
    if (!email || !password) { setError('Email and password are required.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    })
    if (err) { setLoading(false); setError(err.message); return }
    // Start 30-day trial
    if (data.user) {
      await setTrialStartDate(data.user.id).catch(() => {})
      onSuccess(data.user)
    } else {
      setMessage('Check your email to confirm your account.')
    }
    setLoading(false)
  }

  async function handleSignIn() {
    if (!email || !password) { setError('Email and password are required.'); return }
    setLoading(true); setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setLoading(false); setError(err.message); return }
    onSuccess(data.user)
    setLoading(false)
  }

  const inp = {
    width: '100%', background: C.surface, border: '1px solid ' + C.border,
    borderRadius: 8, color: C.text, fontFamily: FB, fontSize: 14,
    padding: '10px 14px', outline: 'none', marginBottom: 12,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 18,
        padding: 32, maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <span style={{ fontSize: 28 }}>🍷</span>
          <div>
            <div style={{ fontFamily: FD, fontSize: 22, color: C.burgundy, lineHeight: 1, fontWeight: 700 }}>Smart</div>
            <div style={{ fontFamily: FD, fontSize: 22, color: C.gold, lineHeight: 1, fontWeight: 600 }}>Cellar</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['signup', 'signin'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: FB, fontWeight: 600, fontSize: 13,
                background: mode === m ? C.burgundy : C.surface,
                color: mode === m ? '#fff' : C.muted }}>
              {m === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
          ))}
        </div>

        {mode === 'signup' && (
          <input style={inp} placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
        )}
        <input style={inp} placeholder="Email address" type="email" value={email}
          onChange={e => setEmail(e.target.value)} />
        <input style={inp} placeholder="Password" type="password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (mode === 'signup' ? handleSignUp() : handleSignIn())} />

        {error && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: '#dc2626', marginBottom: 12 }}>{error}</div>}
        {message && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: C.gold, marginBottom: 12 }}>{message}</div>}

        <button onClick={mode === 'signup' ? handleSignUp : handleSignIn} disabled={loading}
          style={{ width: '100%', padding: '12px', border: 'none', borderRadius: 10,
            background: C.burgundy, color: '#fff', fontFamily: FB, fontWeight: 700,
            fontSize: 14, cursor: 'pointer', opacity: loading ? 0.7 : 1, marginBottom: 12 }}>
          {loading ? 'Please wait…' : mode === 'signup' ? 'Start 30-Day Free Trial' : 'Sign In'}
        </button>

        {mode === 'signup' && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.muted,
            textAlign: 'center', lineHeight: 1.5 }}>
            Free 30-day trial · No credit card required
          </div>
        )}

        <button onClick={onClose} style={{ display: 'block', width: '100%', marginTop: 12,
          background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13 }}>
          Continue without signing in
        </button>
      </div>
    </div>
  )
}

// -- Subscription Modal placeholder (Stripe integration - wired same as SK) ----
function SubscriptionModal({ user, currentTier, onClose, onSubscribed }) {
  const TIERS = [
    {
      id: 'cellar_solo',
      name: 'Smart Cellar',
      monthly: 4.99,
      annual: 39.99,
      annualPerMonth: 3.33,
      color: 'var(--sc-burgundy)',
      desc: 'Full inventory, Smart Pour & AI cocktails',
      features: [
        'Unlimited bottle inventory',
        'Smart Pour (Bluetooth scale)',
        'AI bartender — Make a Drink',
        'What Can I Make? cocktail discovery',
        'DIY craft ingredient guides',
        'Pour history log',
        '30-day free trial',
      ],
    },
    {
      id: 'cellar_family',
      name: 'Smart Cellar Module',
      monthly: 2.99,
      annual: 24.99,
      annualPerMonth: 2.08,
      color: 'var(--sc-gold)',
      desc: 'Add-on for Smart Kitchen subscribers',
      features: [
        'Everything in Smart Cellar',
        'Multi-device sync (bar tablet + phone)',
        'Smart Kitchen meal-pairing integration',
        'Priority cloud sync across all devices',
        'Add-on pricing for SK subscribers',
      ],
    },
  ]
  const [billing, setBilling] = useState('monthly')
  const [loading, setLoading] = useState(null)
  const FB = "'DM Sans', sans-serif"

  async function selectTier(tier) {
    setLoading(tier.id)
    const priceId = billing === 'annual' ? tier.id + '_annual' : tier.id + '_monthly'
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, email: user.email, priceId, tier: tier.id }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch { setLoading(null) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
        borderRadius: 18, padding: 32, maxWidth: 520, width: '100%' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24,
          color: 'var(--sc-burgundy)', marginBottom: 8 }}>Choose a Plan</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: 'var(--sc-muted)', marginBottom: 24 }}>
          Your trial has ended. Choose a plan to continue.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['monthly', 'annual'].map(b => (
            <button key={b} onClick={() => setBilling(b)}
              style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: FB, fontWeight: 600, fontSize: 13,
                background: billing === b ? 'var(--sc-burgundy)' : 'var(--sc-surface)',
                color: billing === b ? '#fff' : 'var(--sc-muted)' }}>
              {b === 'monthly' ? 'Monthly' : 'Annual (save 17%)'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
          {TIERS.map(t => (
            <div key={t.id} style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-border)',
              borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20,
                fontWeight: 700, color: t.color, marginBottom: 4 }}>{t.name}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: 'var(--sc-muted)', marginBottom: 12 }}>{t.desc}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28,
                color: 'var(--sc-text)', marginBottom: 12 }}>
                ${billing === 'annual' ? (t.annual / 12).toFixed(2) : t.monthly}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'var(--sc-muted)' }}>/mo</span>
              </div>
              <button onClick={() => selectTier(t)} disabled={loading === t.id}
                style={{ width: '100%', padding: '10px', border: 'none', borderRadius: 8,
                  background: t.color, color: '#fff', fontFamily: FB, fontWeight: 700,
                  fontSize: 13, cursor: 'pointer', opacity: loading === t.id ? 0.7 : 1 }}>
                {loading === t.id ? 'Loading…' : 'Choose ' + t.name}
              </button>
            </div>
          ))}
        </div>
        <button onClick={onClose} style={{ display: 'block', width: '100%', background: 'none',
          border: 'none', color: 'var(--sc-muted)', cursor: 'pointer', fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// ROOT — Auth wrapper (mirrors Smart Kitchen Root pattern)
// =============================================================================
function Root() {
  const [user, setUser]                 = useState(null)
  const [userProfile, setUserProfile]   = useState(null)
  const [showAuth, setShowAuth]         = useState(false)
  const [showSub, setShowSub]           = useState(false)
  const [authMode, setAuthMode]         = useState('signup')
  const [authReady, setAuthReady]       = useState(false)

  useEffect(() => {
    // Restore theme from localStorage
    const isDark = localStorage.getItem(SC_KEYS.darkMode) !== '0'
    document.body.classList.toggle('sc-dark', isDark)
    document.body.classList.toggle('sc-light', !isDark)

    // Check Supabase session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        getUserProfile(session.user.id).then(setUserProfile)
        loadCloudData(session.user.id).catch(() => {})
      }
      setAuthReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
        getUserProfile(session.user.id).then(setUserProfile)
      } else {
        setUser(null)
        setUserProfile(null)
      }
    })

    // Handle Stripe return
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscription') === 'success') {
      const t = params.get('tier')
      if (t) setUserProfile(p => ({ ...p, tier: t }))
      window.history.replaceState({}, '', window.location.pathname)
    }

    // Save on tab hide
    const onHide = () => {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user) saveCloudData(data.user.id).catch(() => {})
      })
    }
    document.addEventListener('visibilitychange', onHide)
    return () => { subscription.unsubscribe(); document.removeEventListener('visibilitychange', onHide) }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setUser(null); setUserProfile(null)
  }

  // -- Tier resolution (mirrors SK pattern) ------------------------------------
  const isAdmin       = user && ADMIN_EMAILS.includes(user.email?.toLowerCase())
  const rawTier       = userProfile?.tier || 'free'
  const trialEndsAt   = userProfile?.trial_ends_at || null
  const inTrial       = !isAdmin && trialEndsAt && new Date(trialEndsAt) > new Date()
  const effectiveTier = isAdmin ? 'cellar_plus' : (inTrial ? 'cellar_plus' : rawTier)
  const isActive      = isAdmin || userProfile?.subscription_status === 'active' || inTrial
  const daysLeft      = trialDaysRemaining(trialEndsAt)

  // Smart Cellar: scale (Pour & Track) available on ALL tiers — no Medical+ gate
  const can = {
    pourTrack:    true,   // core feature, all tiers
    makeThisDrink: true,
    discoverCocktails: true,
    diyGuides:    true,
    cloudSync:    isAdmin || isActive,
    multiDevice:  isAdmin || effectiveTier === 'cellar_plus',
  }

  const tierLabel = isAdmin ? 'Admin'
    : inTrial ? 'Trial (' + daysLeft + 'd left)'
    : effectiveTier === 'cellar_plus' ? 'Cellar+'
    : effectiveTier === 'cellar_solo' ? 'Solo'
    : 'Free'

  if (!authReady) return null

  return (
    <>
      {/* Top-right auth bar */}
      <div style={{
        position: 'fixed', top: 0, right: 'max(12px, calc((100vw - 1140px) / 2))',
        zIndex: 999, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
      }}>
        {/* Smart Kitchen cross-link */}
        <a href="https://smart-kitchen-opal.vercel.app" target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: '#f0a500', textDecoration: 'none', border: '1px solid #f0a50044',
            borderRadius: 8, padding: '3px 8px', background: '#f0a50010' }}>
          🍳 Smart Kitchen
        </a>

        {user ? (
          <>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: 'var(--sc-muted)', background: 'var(--sc-surface)', padding: '3px 8px',
              borderRadius: 8, border: '1px solid var(--sc-border)' }}>
              {tierLabel}
            </span>
            {!isActive && !isAdmin && (
              <button onClick={() => setShowSub(true)}
                style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, padding: '4px 10px',
                  borderRadius: 10, border: 'none', background: 'var(--sc-burgundy)',
                  color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Upgrade</button>
            )}
            <button onClick={handleSignOut}
              style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, padding: '4px 8px',
                borderRadius: 8, border: '1px solid var(--sc-border)', background: 'transparent',
                color: 'var(--sc-muted)', cursor: 'pointer' }}>Sign Out</button>
          </>
        ) : (
          <button onClick={() => { setAuthMode('signin'); setShowAuth(true) }}
            style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, padding: '5px 14px',
              borderRadius: 10, border: 'none', background: 'var(--sc-burgundy)',
              color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Sign In</button>
        )}
      </div>

      {/* Main App */}
      <App
        user={user}
        tier={effectiveTier}
        can={can}
        onUpgrade={() => { if (!user) { setAuthMode('signup'); setShowAuth(true) } else setShowSub(true) }}
      />

      {/* Auth Modal */}
      {showAuth && (
        <AuthModal
          initialMode={authMode}
          onClose={() => setShowAuth(false)}
          onSuccess={u => { setUser(u); setShowAuth(false); getUserProfile(u.id).then(setUserProfile) }}
        />
      )}

      {/* Subscription Modal */}
      {showSub && user && (
        <SubscriptionModal
          user={user}
          currentTier={effectiveTier}
          onClose={() => setShowSub(false)}
          onSubscribed={t => { setUserProfile(p => ({ ...p, tier: t })); setShowSub(false) }}
        />
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
