// Smart Cellar App v0.1 — June 2026
// RG Digital Labs, LLC
// Standalone React/Vite PWA — shared Supabase + Stripe + Anthropic infra as Smart Kitchen
// Mirrors SK design language: same fonts, same token structure, same component patterns

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { supabase, SC_KEYS, loadCloudData, saveCloudData } from './supabaseClient'
import { useBLEScale, gramsToMl, mlToOz, ozToMl } from './hooks/useBLEScale'
import './App.css'
import GuidedCocktailMaker from './GuidedCocktailMaker'

// -- File helpers (mirrors Smart Kitchen pattern) --------------------------------
function fileToBase64(f) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(f)
  })
}

// Compress image to max 800px wide, JPEG 0.75 quality — keeps localStorage footprint small
// (~50–100KB per bottle photo vs 2–5MB raw)
function compressImage(file, maxPx = 800, quality = 0.75) {
  return new Promise((res, rej) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      res(b64)
    }
    img.onerror = rej
    img.src = url
  })
}

// -- Design tokens (mirrors Smart Kitchen C object) ----------------------------
const C = {
  bg:           'var(--sc-bg)',
  surface:      'var(--sc-surface)',
  card:         'var(--sc-card)',
  cardHover:    'var(--sc-card-hover)',
  border:       'var(--sc-border)',
  borderLight:  'var(--sc-border-light)',
  burgundy:     'var(--sc-burgundy)',
  burgundyDim:  'var(--sc-burgundy-dim)',
  gold:         'var(--sc-gold)',
  goldDim:      'var(--sc-gold-dim)',
  teal:         'var(--sc-teal)',
  tealDim:      'var(--sc-teal-dim)',
  green:        'var(--sc-green)',
  red:          'var(--sc-red)',
  blue:         'var(--sc-blue)',
  purple:       'var(--sc-purple)',
  orange:       'var(--sc-orange)',
  amber:        'var(--sc-amber)',
  text:         'var(--sc-text)',
  muted:        'var(--sc-muted)',
  dim:          'var(--sc-dim)',
}
const FD = "'Cormorant Garamond', serif"
const FB = "'DM Sans', sans-serif"
const FM = "'JetBrains Mono', monospace"

// -- Admin bypass accounts (shared with Smart Kitchen) -------------------------
const ADMIN_EMAILS = ['thesmartkitchenapp@gmail.com', 'michiganrvvacations@gmail.com']

// -- Anthropic API call (Smart Cellar key) -------------------------------------
async function callClaude({ system, prompt, imageBase64, imageType, maxTokens = 800 }) {
  // Build message content — text only, or text + image (mirrors Smart Kitchen pattern)
  const userContent = []
  if (imageBase64) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: imageType || 'image/jpeg', data: imageBase64 },
    })
  }
  userContent.push({ type: 'text', text: prompt })

  // Must include x-api-key and anthropic-dangerous-direct-browser-access for browser calls
  // (mirrors Smart Kitchen callClaude pattern exactly)
  const apiKey = import.meta.env?.VITE_ANTHROPIC_KEY || ''
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error('API error ' + res.status)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'API error')
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
}

// -- Bottle categories ---------------------------------------------------------
const SPIRIT_CATEGORIES = [
  'Whiskey / Bourbon', 'Scotch', 'Rye', 'Irish Whiskey',
  'Vodka', 'Gin', 'Rum', 'Tequila / Mezcal',
  'Brandy / Cognac', 'Liqueur / Cordial', 'Amaro / Bitters',
  'Wine — Red', 'Wine — White', 'Wine — Rosé', 'Wine — Sparkling',
  'Beer / Hard Cider', 'Hard Seltzer', 'Non-Alcoholic',
  'Mixers', 'Syrups & Modifiers', 'Bartesian Pods', 'Other',
]

const CAT_COLORS = {
  'Whiskey / Bourbon': C.amber,
  'Scotch':            '#c9903a',
  'Rye':               '#d4814a',
  'Irish Whiskey':     C.green,
  'Vodka':             C.blue,
  'Gin':               C.teal,
  'Rum':               C.gold,
  'Tequila / Mezcal':  C.green,
  'Brandy / Cognac':   C.burgundy,
  'Liqueur / Cordial': C.purple,
  'Amaro / Bitters':   C.orange,
  'Wine — Red':        C.burgundy,
  'Wine — White':      '#d4bf6a',
  'Wine — Rosé':       '#e87fa0',
  'Wine — Sparkling':  C.teal,
  'Beer / Hard Cider': C.amber,
  'Hard Seltzer':      C.blue,
  'Non-Alcoholic':     C.green,
  'Mixers':            C.muted,
  'Syrups & Modifiers': C.gold,
  'Bartesian Pods':    C.purple,
  'Other':             C.muted,
}

// -- Standard pour sizes -------------------------------------------------------
const POUR_PRESETS = [
  { label: '1 oz shot',       oz: 1.0 },
  { label: '1.5 oz shot',     oz: 1.5 },
  { label: '2 oz pour',       oz: 2.0 },
  { label: '5 oz wine',       oz: 5.0 },
  { label: '8 oz pint (½)',   oz: 8.0 },
  { label: '16 oz pint',      oz: 16.0 },
]

// -- Wine sweetness levels (per RS chart) -------------------------------------
const WINE_SWEETNESS = [
  { value: '',           label: '— Select —' },
  { value: 'Bone Dry',   label: 'Bone Dry  (< 1 g/L RS)',        color: '#6b728e' },
  { value: 'Dry',        label: 'Dry  (1–10 g/L RS)',            color: '#3ecf8e' },
  { value: 'Off-Dry',    label: 'Off-Dry  (10–35 g/L RS)',       color: '#2dd4bf' },
  { value: 'Semi-Sweet', label: 'Semi-Sweet  (35–50 g/L RS)',    color: '#c9903a' },
  { value: 'Sweet',      label: 'Sweet  (50–120 g/L RS)',        color: '#f59e0b' },
  { value: 'Very Sweet', label: 'Very Sweet  (> 120 g/L RS)',    color: '#a78bfa' },
]
const WINE_CATEGORIES = ['Wine — Red', 'Wine — White', 'Wine — Rosé', 'Wine — Sparkling']
function isWineCategory(cat) { return WINE_CATEGORIES.includes(cat) }

// -- Shared button style helpers (mirrors SK pattern) --------------------------
function bBtn(variant = 'primary', extra = {}) {
  const base = {
    border: 'none', borderRadius: 10, cursor: 'pointer',
    fontFamily: FB, fontWeight: 600, fontSize: 13,
    padding: '10px 18px', transition: 'opacity 0.15s, transform 0.1s',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
  if (variant === 'primary')   return { ...base, background: C.burgundy,  color: '#fff', ...extra }
  if (variant === 'gold')      return { ...base, background: C.gold,       color: '#fff', ...extra }
  if (variant === 'teal')      return { ...base, background: C.teal,       color: '#0c0e14', ...extra }
  if (variant === 'ghost')     return { ...base, background: C.surface,    color: C.text,   border: '1px solid ' + C.border, ...extra }
  if (variant === 'danger')    return { ...base, background: 'transparent', color: C.red,    border: '1px solid ' + C.red + '44', ...extra }
  if (variant === 'sk-promo')  return { ...base, background: '#f0a500',    color: '#0c0e14', ...extra }
  return base
}

function bInp(extra = {}) {
  return {
    width: '100%', background: C.surface, border: '1px solid ' + C.border,
    borderRadius: 8, color: C.text, fontFamily: FB, fontSize: 13,
    padding: '9px 12px', outline: 'none', ...extra,
  }
}

function bCard(extra = {}) {
  return {
    background: C.card, border: '1px solid ' + C.border,
    borderRadius: 14, padding: 16, ...extra,
  }
}

// -- LocalStorage helpers ------------------------------------------------------
function loadLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback }
  catch { return fallback }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// =============================================================================
// SMART CELLAR — MAIN APP COMPONENT
// =============================================================================
export default function App({ user, tier, can, onUpgrade, onAuthAction }) {
  const isAdmin = user && ADMIN_EMAILS.includes(user.email?.toLowerCase())

  // -- Cellar inventory --------------------------------------------------------
  const [cellar, setCellar] = useState(() => loadLS(SC_KEYS.cellar, []))
  const [pourLog, setPourLog] = useState(() => loadLS(SC_KEYS.pourLog, []))
  const [cocktailFavs, setCocktailFavs] = useState(() => loadLS(SC_KEYS.cocktailFavs, []))
  const [showGuidedMaker, setShowGuidedMaker] = useState(false)
  const [guidedCocktail, setGuidedCocktail]   = useState(null)
  const [bartesianPods, setBartesianPods] = useState(() => loadLS(SC_KEYS.bartesianPods, []))
  const [unitPref, setUnitPref] = useState(() => localStorage.getItem(SC_KEYS.unitPref) || 'oz')
  const [syncStatus, setSyncStatus] = useState(null)  // null | 'syncing' | 'done' | 'error'

  // -- Theme & accessibility (mirrors SK pattern, sc_ keys) --------------------
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem(SC_KEYS.darkMode) !== '0' } catch { return true }
  })
  const [seniorMode, setSeniorMode] = useState(() => {
    try { return localStorage.getItem('sc_seniorMode') === '1' } catch { return false }
  })

  // Persist cellar to localStorage on change
  useEffect(() => { saveLS(SC_KEYS.cellar, cellar) }, [cellar])
  useEffect(() => { saveLS(SC_KEYS.pourLog, pourLog) }, [pourLog])
  useEffect(() => { saveLS(SC_KEYS.cocktailFavs, cocktailFavs) }, [cocktailFavs])
  useEffect(() => { saveLS(SC_KEYS.bartesianPods, bartesianPods) }, [bartesianPods])
  useEffect(() => { localStorage.setItem(SC_KEYS.unitPref, unitPref) }, [unitPref])

  // Apply theme class to body on mount and toggle
  useEffect(() => {
    document.body.classList.toggle('sc-dark', isDark)
    document.body.classList.toggle('sc-light', !isDark)
    localStorage.setItem(SC_KEYS.darkMode, isDark ? '1' : '0')
  }, [isDark])

  // Apply senior mode class to body
  useEffect(() => {
    document.body.classList.toggle('sc-senior', seniorMode)
    localStorage.setItem('sc_seniorMode', seniorMode ? '1' : '0')
  }, [seniorMode])

  // Auto cloud-save every 90s when signed in (mirrors SK pattern)
  useEffect(() => {
    if (!user) return
    const interval = setInterval(() => saveCloudData(user.id).catch(() => {}), 90_000)
    return () => clearInterval(interval)
  }, [user])

  // Theme toggle
  function toggleTheme() { setIsDark(d => !d) }

  // Senior / large text toggle (reloads to reapply all font sizes)
  function toggleSenior() {
    const next = !seniorMode
    setSeniorMode(next)
    localStorage.setItem('sc_seniorMode', next ? '1' : '0')
    document.body.classList.toggle('sc-senior', next)
  }

  // Open guided cocktail maker
  function openGuidedMaker(cocktail) {
    setGuidedCocktail(cocktail)
    setShowGuidedMaker(true)
  }

  // Manual sync with Smart Kitchen
  async function syncWithSmartKitchen() {
    if (!user) { alert('Sign in to sync with Smart Kitchen.'); return }
    setSyncStatus('syncing')
    try {
      await saveCloudData(user.id)
      setSyncStatus('done')
      setTimeout(() => setSyncStatus(null), 3000)
    } catch {
      setSyncStatus('error')
      setTimeout(() => setSyncStatus(null), 3000)
    }
  }

  // -- Scanner state (bottle photo / receipt / manual — mirrors SK scan pattern) --
  const [showScanner, setShowScanner]       = useState(false)
  const [scanMode, setScanMode]             = useState('bottle')   // 'bottle' | 'receipt' | 'manual'
  const [scanStage, setScanStage]           = useState('upload')   // 'upload' | 'analyzing' | 'review' | 'done'
  const [scanPreview, setScanPreview]       = useState(null)
  const [scanB64, setScanB64]               = useState(null)
  const [scanMime, setScanMime]             = useState('image/jpeg')
  const [scanResults, setScanResults]       = useState(null)       // array of detected bottles
  const [scanB64Compressed, setScanB64Compressed] = useState(null)
  const fileRef   = useRef(null)
  const galleryRef = useRef(null)

  // -- Active view -------------------------------------------------------------
  const [view, setView] = useState('cellar')  // cellar | pour | make | discover | diy | bartesian | log

  // -- Add/Edit bottle modal ---------------------------------------------------
  const [showAddBottle, setShowAddBottle]     = useState(false)
  const [editingBottle, setEditingBottle]     = useState(null)
  const [bottleForm, setBottleForm]           = useState({
    name: '', category: 'Whiskey / Bourbon', brand: '', producer: '',
    size_ml: 750, remaining_pct: 100, proof: '', vintage: '',
    location: 'Bar Cart', notes: '', sweetness: '', winery_url: '', photo_b64: null,
  })

  // -- Pour & Track modal ------------------------------------------------------
  const [showPourModal, setShowPourModal]     = useState(false)
  const [pourBottle, setPourBottle]           = useState(null)  // bottle being poured
  const [pourPhase, setPourPhase]             = useState('tare') // tare | pouring | done
  const [pourTargetOz, setPourTargetOz]       = useState(1.5)
  const [pourStartGrams, setPourStartGrams]   = useState(0)
  const [pourResult, setPourResult]           = useState(null)

  // -- Make This Drink modal ---------------------------------------------------
  const [showMakeModal, setShowMakeModal]     = useState(false)
  const [makeBottle, setMakeBottle]           = useState(null)
  const [makeResult, setMakeResult]           = useState(null)
  const [makeLoading, setMakeLoading]         = useState(false)

  // -- What Can I Make? --------------------------------------------------------
  const [showDiscoverModal, setShowDiscoverModal] = useState(false)
  const [discoverResult, setDiscoverResult]       = useState(null)
  const [discoverLoading, setDiscoverLoading]     = useState(false)
  const [discoverQuery, setDiscoverQuery]         = useState('')

  // -- Smart Kitchen cross-promo (detected from SK_crossPromo flag) -------------
  const [skTrialSource, setSkTrialSource] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('from') === 'smart-kitchen') setSkTrialSource(true)
  }, [])

  // -- BLE Scale hook -----------------------------------------------------------
  const scale = useBLEScale()

  // ==========================================================================
  // BOTTLE CRUD
  // ==========================================================================
  function openAddBottle(preset = null) {
    setEditingBottle(null)
    setBottleForm(preset ?? {
      name: '', category: 'Whiskey / Bourbon', brand: '', producer: '',
      size_ml: 750, remaining_pct: 100, proof: '', vintage: '',
      location: 'Bar Cart', notes: '', sweetness: '', winery_url: '',
    })
    setShowAddBottle(true)
  }

  function openEditBottle(bottle) {
    setEditingBottle(bottle)
    setBottleForm({ ...bottle })
    setShowAddBottle(true)
  }

  function saveBottle() {
    if (!bottleForm.name?.trim()) return
    const now = new Date().toISOString()
    if (editingBottle) {
      setCellar(c => c.map(b => b.id === editingBottle.id ? { ...b, ...bottleForm, updatedAt: now } : b))
    } else {
      setCellar(c => [...c, { id: Date.now(), ...bottleForm, addedAt: now, updatedAt: now }])
    }
    setShowAddBottle(false)
  }

  function deleteBottle(id) {
    setCellar(c => c.filter(b => b.id !== id))
  }

  // ==========================================================================
  // BOTTLE SCANNER
  // ==========================================================================
  function openScanner(mode = 'bottle') {
    setScanMode(mode)
    setScanStage('upload')
    setScanPreview(null)
    setScanB64(null)
    setScanResults(null)
    setShowScanner(true)
  }

  async function onScanFile(file) {
    if (!file) {
      setScanPreview(null)
      setScanB64(null)
      return
    }
    setScanPreview(URL.createObjectURL(file))
    // Full-res for API vision call; compressed copy saved to bottle card
    setScanB64(await fileToBase64(file))
    setScanMime(file.type || 'image/jpeg')
    // Pre-compute compressed version for storage (attached in commitScanResults)
    try {
      const compressed = await compressImage(file)
      setScanB64Compressed(compressed)
    } catch { setScanB64Compressed(null) }
    setScanResults(null)
    setScanStage('upload')
  }

  async function analyzeBottlePhoto() {
    if (!scanB64) return
    setScanStage('analyzing')
    try {
      const raw = await callClaude({
        system: `You are an expert spirits and wine identifier. Analyze this bottle photo and extract all visible bottle information.
Return ONLY valid JSON — no markdown, no preamble — as an array of bottle objects (usually 1, but could be multiple if several bottles are visible):
[{"name":"string (brand + expression, e.g. Maker's Mark Bourbon)","brand":"string","producer":"string or null (winery, distillery, or brewery name — e.g. St. Julian Winery, Buffalo Trace Distillery. Often different from the brand/label name)","category":"string (must be one of: Whiskey / Bourbon|Scotch|Rye|Irish Whiskey|Vodka|Gin|Rum|Tequila / Mezcal|Brandy / Cognac|Liqueur / Cordial|Amaro / Bitters|Wine — Red|Wine — White|Wine — Rosé|Wine — Sparkling|Beer / Hard Cider|Non-Alcoholic|Other)","proof":"string or null (e.g. '90' or '45% ABV')","vintage":"string or null (year if visible)","sweetness":"string or null — for wines only: Bone Dry|Dry|Off-Dry|Semi-Sweet|Sweet|Very Sweet based on wine type","winery_url":null,"size_ml":750,"remaining_pct":100,"location":"Bar Cart","notes":"string or null","confidence":"high|medium|low"}]
If the label is unreadable, return a best guess with confidence=low. Never return an empty array — always return at least one object.`,
        prompt: 'Identify all bottles visible in this photo. Extract brand, spirit type, proof/ABV, and any vintage year visible on the label.',
        imageBase64: scanB64,
        imageType: scanMime,
        maxTokens: 800,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const s = clean.indexOf('['), e = clean.lastIndexOf(']')
      const bottles = JSON.parse(clean.slice(s, e + 1))
      setScanResults(bottles.map(b => ({ ...b, selected: true, id: Date.now() + Math.random() })))
      setScanStage('review')
    } catch (err) {
      alert('Could not identify bottle: ' + err.message)
      setScanStage('upload')
    }
  }

  async function analyzeReceiptPhoto() {
    if (!scanB64) return
    setScanStage('analyzing')
    try {
      const raw = await callClaude({
        system: `You are a liquor store receipt parser. Analyze this receipt and extract all alcohol/beverage purchases.
Return ONLY valid JSON array — no markdown:
[{"name":"string (brand + expression)","brand":"string or null","producer":"string or null (winery or distillery name)","category":"string (Whiskey / Bourbon|Scotch|Rye|Irish Whiskey|Vodka|Gin|Rum|Tequila / Mezcal|Brandy / Cognac|Liqueur / Cordial|Wine — Red|Wine — White|Wine — Rosé|Wine — Sparkling|Beer / Hard Cider|Mixers|Other)","size_ml":750,"proof":null,"vintage":null,"sweetness":null,"winery_url":null,"remaining_pct":100,"location":"Bar Cart","price":"string or null","qty":1,"confidence":"high|medium|low"}]
If an item is clearly non-alcoholic, still include it. Skip food items.`,
        prompt: 'Parse this receipt. Extract every bottle/beverage purchased.',
        imageBase64: scanB64,
        imageType: scanMime,
        maxTokens: 1000,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const s = clean.indexOf('['), e = clean.lastIndexOf(']')
      const bottles = JSON.parse(clean.slice(s, e + 1))
      // Expand by qty (if someone bought 2 of something, add 2 entries)
      const expanded = bottles.flatMap(b => {
        const count = parseInt(b.qty) || 1
        return Array.from({ length: count }, (_, i) => ({
          ...b, selected: true, id: Date.now() + Math.random() + i
        }))
      })
      setScanResults(expanded)
      setScanStage('review')
    } catch (err) {
      alert('Could not read receipt: ' + err.message)
      setScanStage('upload')
    }
  }

  function commitScanResults() {
    const now = new Date().toISOString()
    const toAdd = (scanResults || [])
      .filter(b => b.selected)
      .map(({ selected, id, price, qty, confidence, ...bottle }) => ({
        id: Date.now() + Math.random(),
        ...bottle,
        size_ml: bottle.size_ml || 750,
        remaining_pct: bottle.remaining_pct ?? 100,
        location: bottle.location || 'Bar Cart',
        // Attach the scan photo to the bottle so it shows on the card
        photo_b64: bottle.photo_b64 || scanB64Compressed || null,
        addedAt: now,
        updatedAt: now,
      }))
    setCellar(c => [...c, ...toAdd])
    setShowScanner(false)
    setScanStage('done')
    setScanPreview(null)
    setScanB64(null)
    setScanResults(null)
  }

  // ==========================================================================
  // POUR & TRACK
  // ==========================================================================
  function openPour(bottle) {
    setPourBottle(bottle)
    setPourPhase('tare')
    setPourResult(null)
    setPourStartGrams(0)
    setShowPourModal(true)
  }

  function startPour() {
    // Capture tare weight (current stable grams = container weight)
    setPourStartGrams(scale.weightGrams)
    setPourPhase('pouring')
  }

  function finishPour() {
    const poured_g  = Math.max(0, scale.weightGrams - pourStartGrams)
    const poured_ml = gramsToMl(poured_g, categoryToLiquid(pourBottle?.category))
    const poured_oz = mlToOz(poured_ml)

    const entry = {
      id: Date.now(),
      bottle_id:   pourBottle.id,
      bottle_name: pourBottle.name,
      category:    pourBottle.category,
      poured_g:    +poured_g.toFixed(1),
      poured_ml:   +poured_ml.toFixed(1),
      poured_oz:   +poured_oz.toFixed(2),
      poured_at:   new Date().toISOString(),
    }
    setPourResult(entry)
    setPourLog(l => [entry, ...l.slice(0, 499)])

    // Deduct from bottle remaining_pct (rough: assume full bottle = 750ml)
    const bottle_ml = pourBottle.size_ml || 750
    const pct_used  = (poured_ml / bottle_ml) * 100
    setCellar(c => c.map(b => b.id === pourBottle.id
      ? { ...b, remaining_pct: Math.max(0, (b.remaining_pct || 100) - pct_used) }
      : b
    ))
    setPourPhase('done')
  }

  function categoryToLiquid(cat = '') {
    if (cat.toLowerCase().includes('wine')) return 'wine'
    if (cat.toLowerCase().includes('beer')) return 'beer'
    return 'spirits'
  }

  // ==========================================================================
  // MAKE THIS DRINK — AI Bartender
  // ==========================================================================
  async function makeDrink(bottle) {
    setMakeBottle(bottle)
    setMakeResult(null)
    setMakeLoading(true)
    setShowMakeModal(true)
    const inventory = cellar.map(b => `${b.name} (${b.category}, ${Math.round(b.remaining_pct || 100)}% remaining)`).join(', ')
    try {
      const raw = await callClaude({
        system: `You are an expert AI bartender. Given a featured spirit and available cellar inventory, suggest 3 cocktail recipes.
Return ONLY valid JSON — no markdown, no preamble — in this exact shape:
{"cocktails":[{"name":"string","description":"string","ingredients":[{"item":"string","amount":"string"}],"steps":["string"],"garnish":"string","glassware":"string","difficulty":"Easy|Medium|Advanced","tasting_notes":"string"}]}`,
        prompt: `Featured spirit: ${bottle.name} (${bottle.category}, ${bottle.proof ? bottle.proof + ' proof' : 'proof unknown'}).
Full cellar inventory: ${inventory}.
Suggest 3 cocktails ranging from classic to creative. Prefer recipes using ingredients already in the cellar. Include at least one simple 2-3 ingredient recipe.`,
        maxTokens: 1200,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
      setMakeResult(JSON.parse(clean.slice(s, e + 1)))
    } catch (err) {
      setMakeResult({ error: 'Could not generate cocktails. Please try again.' })
    }
    setMakeLoading(false)
  }

  // ==========================================================================
  // WHAT CAN I MAKE? — Discovery
  // ==========================================================================
  async function discoverCocktails(query = '') {
    setDiscoverResult(null)
    setDiscoverLoading(true)
    setShowDiscoverModal(true)
    const inventory = cellar.filter(b => (b.remaining_pct || 100) > 5)
      .map(b => `${b.name} (${b.category})`).join(', ')
    try {
      const raw = await callClaude({
        system: `You are an expert AI bartender specializing in cellar-driven cocktail discovery.
Return ONLY valid JSON — no markdown — in this exact shape:
{"cocktails":[{"name":"string","description":"string","primary_spirit":"string","ingredients":[{"item":"string","amount":"string","in_cellar":true}],"steps":["string"],"garnish":"string","glassware":"string","difficulty":"Easy|Medium|Advanced","missing":["string"]}],"tip":"string"}`,
        prompt: `User's cellar inventory: ${inventory}.
${query ? 'User request: ' + query + '.' : 'Surprise them with a creative selection.'}
Suggest 4 cocktails they can make RIGHT NOW (or nearly). Prioritize drinks requiring the fewest missing ingredients. Mark each ingredient in_cellar true/false. Include a friendly tip.`,
        maxTokens: 1400,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
      setDiscoverResult(JSON.parse(clean.slice(s, e + 1)))
    } catch {
      setDiscoverResult({ error: 'Could not discover cocktails. Please try again.' })
    }
    setDiscoverLoading(false)
  }

  // ==========================================================================
  // POUR FILL GRAPHIC — visual wine/glass fill indicator
  // ==========================================================================
  function PourFillGraphic({ poured_oz, target_oz, category }) {
    const fillPct = Math.min(100, target_oz > 0 ? (poured_oz / target_oz) * 100 : 0)
    const isWine  = (category || '').toLowerCase().includes('wine')
    const fillColor = fillPct >= 98 ? C.teal : fillPct >= 85 ? C.gold : C.burgundy

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {/* Glass SVG */}
        <svg width={80} height={130} viewBox="0 0 80 130" style={{ overflow: 'visible' }}>
          {/* Glass outline */}
          {isWine ? (
            // Wine glass shape
            <>
              <path d="M20 10 Q10 50 30 80 L40 90 L50 80 Q70 50 60 10 Z"
                fill="none" stroke={C.border} strokeWidth={2} />
              <line x1={40} y1={90} x2={40} y2={120} stroke={C.border} strokeWidth={2} />
              <line x1={25} y1={120} x2={55} y2={120} stroke={C.border} strokeWidth={2} />
              {/* Fill */}
              <clipPath id="wine-clip">
                <path d="M20 10 Q10 50 30 80 L40 90 L50 80 Q70 50 60 10 Z" />
              </clipPath>
              <rect x={18} y={10 + (70 * (1 - fillPct / 100))} width={44}
                height={70 * (fillPct / 100)} fill={fillColor} opacity={0.7}
                clipPath="url(#wine-clip)"
                style={{ transition: 'height 0.3s, y 0.3s' }} />
            </>
          ) : (
            // Rocks / highball glass shape
            <>
              <path d="M18 10 L22 110 L58 110 L62 10 Z"
                fill="none" stroke={C.border} strokeWidth={2} />
              {/* Fill */}
              <clipPath id="rocks-clip">
                <path d="M18 10 L22 110 L58 110 L62 10 Z" />
              </clipPath>
              <rect x={20} y={10 + (100 * (1 - fillPct / 100))} width={40}
                height={100 * (fillPct / 100)} fill={fillColor} opacity={0.7}
                clipPath="url(#rocks-clip)"
                style={{ transition: 'height 0.3s, y 0.3s' }} />
            </>
          )}
        </svg>
        <div style={{ fontFamily: FM, fontSize: 11, color: fillColor, fontWeight: 700 }}>
          {fillPct.toFixed(0)}% of target
        </div>
      </div>
    )
  }

  // ==========================================================================
  // POUR PROGRESS — live during pour phase
  // ==========================================================================
  function LivePourProgress() {
    const poured_g  = Math.max(0, scale.weightGrams - pourStartGrams)
    const poured_ml = gramsToMl(poured_g, categoryToLiquid(pourBottle?.category))
    const poured_oz = mlToOz(poured_ml)

    return (
      <div style={{ textAlign: 'center' }}>
        <PourFillGraphic poured_oz={poured_oz} target_oz={pourTargetOz} category={pourBottle?.category} />
        <div style={{ fontFamily: FD, fontSize: 48, color: C.text, lineHeight: 1, marginTop: 8 }}>
          {unitPref === 'oz' ? poured_oz.toFixed(2) : poured_ml.toFixed(1)}
        </div>
        <div style={{ fontFamily: FM, fontSize: 16, color: C.muted }}>{unitPref}</div>
        <div style={{ fontFamily: FM, fontSize: 11, color: C.muted, marginTop: 4 }}>
          Target: {unitPref === 'oz' ? pourTargetOz.toFixed(1) + ' oz' : ozToMl(pourTargetOz).toFixed(0) + ' ml'}
        </div>
        {poured_oz >= pourTargetOz * 0.98 && (
          <div style={{ fontFamily: FM, fontSize: 12, color: C.teal, fontWeight: 700, marginTop: 8 }}>
            ✓ Target reached — stop pouring!
          </div>
        )}
      </div>
    )
  }

  // ==========================================================================
  // CELLAR LIST VIEW
  // ==========================================================================
  const [cellarSearch, setCellarSearch]     = useState('')
  const [cellarFilter, setCellarFilter]     = useState('All')

  const filteredCellar = cellar.filter(b => {
    const matchSearch = !cellarSearch || b.name.toLowerCase().includes(cellarSearch.toLowerCase())
      || (b.brand || '').toLowerCase().includes(cellarSearch.toLowerCase())
    const matchFilter = cellarFilter === 'All' || b.category === cellarFilter
    return matchSearch && matchFilter
  })

  const categories = ['All', ...SPIRIT_CATEGORIES.filter(c => cellar.some(b => b.category === c))]

  // ==========================================================================
  // RENDER
  // ==========================================================================
  // Font scale: normal = 1.0, senior = 1.28 (~18px base from 14px)
  const fontScale = seniorMode ? 1.28 : 1.0

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text, fontFamily: FB,
      fontSize: seniorMode ? '22px' : '15px',
    }}>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: C.surface + 'ee', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid ' + C.border,
      }}>

        {/* ── Row 1: Logo · Sync · Unit · Sign In/Out ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px', height: 46, gap: 6,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            <div style={{ fontSize: 20 }}>🍷</div>
            <div style={{ lineHeight: 1.1 }}>
              <span style={{ fontFamily: FD, fontSize: 16, color: C.burgundy, fontWeight: 700 }}>Smart </span>
              <span style={{ fontFamily: FD, fontSize: 16, color: C.gold, fontWeight: 600 }}>Cellar</span>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>

            {/* Unit toggle */}
            <button onClick={() => setUnitPref(u => u === 'oz' ? 'ml' : 'oz')}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                padding: '3px 8px', borderRadius: 7, border: '1px solid ' + C.border,
                background: 'transparent', color: C.muted, cursor: 'pointer' }}>
              {unitPref}
            </button>

            {/* Sign In / Out */}
            {onAuthAction && (
              <button onClick={onAuthAction}
                style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10,
                  padding: '4px 10px', borderRadius: 8, fontWeight: 700,
                  border: user ? '1px solid ' + C.border : 'none',
                  background: user ? 'transparent' : C.burgundy,
                  color: user ? C.muted : '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {user ? 'Sign Out' : 'Sign In'}
              </button>
            )}
          </div>
        </div>

        {/* ── Row 2: Nav tabs ── */}
        <nav style={{
          display: 'flex', gap: 4, overflowX: 'auto',
          padding: '0 8px 7px', scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}>
          {[
            { id: 'cellar',   label: '🍾 Cellar' },
            { id: 'pour',     label: '⚖ Pour' },
            { id: 'make',     label: '🍹 Make' },
            { id: 'discover', label: '✨ Discover' },
            { id: 'diy',      label: '🧪 DIY' },
            { id: 'log',      label: '📋 Log' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setView(id)}
              style={{
                flexShrink: 0, border: 'none', borderRadius: 20, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 11,
                padding: '5px 13px', whiteSpace: 'nowrap', transition: 'all 0.15s',
                background: view === id ? C.burgundy : C.surface,
                color: view === id ? '#fff' : C.muted,
                outline: view === id ? 'none' : '1px solid ' + C.border,
              }}>
              {label}
            </button>
          ))}

          {/* ── Accessibility toggles in nav row ── */}
          <button onClick={toggleTheme}
            title={isDark ? 'Light Mode' : 'Dark Mode'}
            style={{
              flexShrink: 0, borderRadius: 20, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13,
              padding: '4px 10px', whiteSpace: 'nowrap', transition: 'all 0.15s',
              border: '1px solid ' + C.border,
              background: 'transparent', color: C.muted,
              marginLeft: 4,
            }}>
            {isDark ? '☀️' : '🌙'}
          </button>

          <button onClick={toggleSenior}
            title={seniorMode ? 'Normal Text' : 'Large Text'}
            style={{
              flexShrink: 0, borderRadius: 20, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12,
              padding: '4px 10px', whiteSpace: 'nowrap', transition: 'all 0.15s',
              border: '1px solid ' + (seniorMode ? C.gold : C.border),
              background: seniorMode ? C.gold + '22' : 'transparent',
              color: seniorMode ? C.gold : C.muted,
            }}>
            {seniorMode ? 'Aa✓' : 'Aa'}
          </button>

          {/* ☁ Sync with Smart Kitchen — lives in nav row with room to breathe */}
          {user && (
            <button onClick={syncWithSmartKitchen} disabled={syncStatus === 'syncing'}
              title="Push your cellar inventory to Smart Kitchen for drink pairing"
              style={{
                flexShrink: 0, border: 'none', borderRadius: 20, cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11,
                padding: '5px 14px', whiteSpace: 'nowrap', transition: 'all 0.2s',
                background: syncStatus === 'done'    ? C.teal
                          : syncStatus === 'error'   ? C.red
                          : syncStatus === 'syncing' ? C.border
                          : '#f0a50030',
                color: syncStatus === 'done'    ? '#0c0e14'
                     : syncStatus === 'error'   ? '#fff'
                     : syncStatus === 'syncing' ? C.muted
                     : '#f0a500',
                outline: syncStatus ? 'none' : '1px solid #f0a50055',
                marginLeft: 4,
              }}>
              {syncStatus === 'syncing' ? '⟳ Syncing…'
                : syncStatus === 'done'  ? '✓ Synced!'
                : syncStatus === 'error' ? '✕ Error'
                : '☁ Sync with Smart Kitchen'}
            </button>
          )}
        </nav>
      </header>

      {/* ── SMART KITCHEN CROSS-PROMO BANNER ────────────────────────────────── */}
      {skTrialSource && (
        <div style={{
          background: '#f0a50018', borderBottom: '1px solid #f0a50044',
          padding: '10px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ fontFamily: FM, fontSize: 12, color: '#f0a500' }}>
            🍳 Welcome from Smart Kitchen! Your 30-day Smart Cellar trial is active.
          </div>
          <a href="https://smart-kitchen-opal.vercel.app" target="_blank" rel="noopener noreferrer"
            style={{ ...bBtn('sk-promo'), fontSize: 11, padding: '4px 12px', textDecoration: 'none' }}>
            ← Back to Smart Kitchen
          </a>
        </div>
      )}

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* ━━━━━ MY CELLAR VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'cellar' && (
          <div>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="Search bottles..." value={cellarSearch}
                onChange={e => setCellarSearch(e.target.value)}
                style={{ ...bInp({ flex: 1, minWidth: 180, maxWidth: 300 }) }} />
              <button onClick={() => openScanner('bottle')} style={{ ...bBtn('primary') }}>📷 Scan Bottle</button>
              <button onClick={() => openScanner('receipt')} style={{ ...bBtn('ghost') }}>🧾 Receipt</button>
              <button onClick={() => openAddBottle()} style={{ ...bBtn('ghost') }}>✏ Manual</button>
              <button onClick={() => { setDiscoverQuery(''); discoverCocktails() }}
                style={{ ...bBtn('teal') }}>✨ What Can I Make?</button>
            </div>

            {/* Category filter chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setCellarFilter(cat)}
                  style={{
                    ...bBtn('ghost'),
                    fontSize: 11, padding: '4px 12px',
                    background: cellarFilter === cat ? (CAT_COLORS[cat] || C.burgundy) + '22' : 'transparent',
                    borderColor: cellarFilter === cat ? (CAT_COLORS[cat] || C.burgundy) : C.border,
                    color: cellarFilter === cat ? (CAT_COLORS[cat] || C.burgundy) : C.muted,
                  }}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Empty state */}
            {filteredCellar.length === 0 && (
              <div style={{ ...bCard(), textAlign: 'center', padding: 48 }}>
                <div style={{ fontSize: 52, marginBottom: 12 }}>🍾</div>
                <div style={{ fontFamily: FD, fontSize: 22, color: C.text, marginBottom: 8 }}>
                  Your cellar is empty
                </div>
                <div style={{ fontFamily: FM, fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>
                  Start by adding your bottles. Smart Cellar will track inventory,<br />
                  guide your pours, and suggest cocktails from what you have.
                </div>
                <button onClick={() => openAddBottle()} style={{ ...bBtn('primary'), fontSize: 14, padding: '12px 28px' }}>
                  + Add Your First Bottle
                </button>
              </div>
            )}

            {/* Bottle grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {filteredCellar.map(bottle => (
                <BottleCard key={bottle.id} bottle={bottle}
                  onEdit={() => openEditBottle(bottle)}
                  onDelete={() => deleteBottle(bottle.id)}
                  onPour={() => openPour(bottle)}
                  onMake={() => makeDrink(bottle)}
                  unitPref={unitPref}
                  seniorMode={seniorMode}
                />
              ))}
            </div>
          </div>
        )}

        {/* ━━━━━ POUR & TRACK VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'pour' && (
          <PourTrackView
            cellar={cellar} scale={scale} unitPref={unitPref}
            onOpenPour={openPour}
          />
        )}

        {/* ━━━━━ MAKE A DRINK VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'make' && (
          <MakeADrinkView cellar={cellar} onMake={makeDrink} />
        )}

        {/* ━━━━━ DISCOVER VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'discover' && (
          <DiscoverView onDiscover={discoverCocktails}
            query={discoverQuery} setQuery={setDiscoverQuery} />
        )}

        {/* ━━━━━ DIY INGREDIENTS VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'diy' && <DIYView />}

        {/* ━━━━━ POUR LOG VIEW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        {view === 'log' && (
          <PourLogView pourLog={pourLog} unitPref={unitPref} onClear={() => setPourLog([])} />
        )}
      </main>

      {/* ━━━━━━━━━━ MODALS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      {/* ── BOTTLE SCANNER MODAL ────────────────────────────────────────────── */}
      {showScanner && (
        <Modal onClose={() => { setShowScanner(false); setScanStage('upload'); setScanPreview(null); setScanB64(null); setScanB64Compressed(null); setScanResults(null) }}
          title={scanMode === 'bottle' ? '📷 Scan Bottle' : '🧾 Receipt Scanner'}>
          <ScannerModal
            scanMode={scanMode} setScanMode={setScanMode}
            scanStage={scanStage} setScanStage={setScanStage}
            scanPreview={scanPreview} scanB64={scanB64}
            scanResults={scanResults} setScanResults={setScanResults}
            onFile={onScanFile}
            onAnalyzeBottle={analyzeBottlePhoto}
            onAnalyzeReceipt={analyzeReceiptPhoto}
            onCommit={commitScanResults}
            onClose={() => { setShowScanner(false); setScanStage('upload'); setScanPreview(null); setScanB64(null); setScanResults(null) }}
            onManual={() => { setShowScanner(false); openAddBottle() }}
            fileRef={fileRef}
            galleryRef={galleryRef}
          />
        </Modal>
      )}

      {/* Add / Edit Bottle */}
      {showAddBottle && (
        <Modal onClose={() => setShowAddBottle(false)} title={editingBottle ? 'Edit Bottle' : 'Add to Cellar'}>
          <BottleForm form={bottleForm} onChange={f => setBottleForm(p => ({ ...p, ...f }))} />
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button onClick={saveBottle} style={{ ...bBtn('primary'), flex: 1 }}>
              {editingBottle ? 'Save Changes' : 'Add Bottle'}
            </button>
            <button onClick={() => setShowAddBottle(false)} style={{ ...bBtn('ghost') }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Pour & Track */}
      {showPourModal && pourBottle && (
        <Modal onClose={() => { setShowPourModal(false); scale.disconnect() }}
          title="⚖ Smart Pour">
          <PourModal
            bottle={pourBottle}
            scale={scale}
            phase={pourPhase}
            targetOz={pourTargetOz}
            setTargetOz={setPourTargetOz}
            onTare={() => { scale.tare(); startPour() }}
            onFinish={finishPour}
            onDone={() => setShowPourModal(false)}
            pourResult={pourResult}
            unitPref={unitPref}
            LivePourProgress={LivePourProgress}
            PourFillGraphic={PourFillGraphic}
          />
        </Modal>
      )}

      {/* Make This Drink */}
      {showMakeModal && (
        <Modal onClose={() => setShowMakeModal(false)}
          title={makeBottle ? `🍹 Drinks with ${makeBottle.name}` : '🍹 Make a Drink'}>
          {makeLoading && <LoadingSpinner text="Your AI bartender is crafting cocktails…" />}
          {makeResult?.error && <ErrorMsg msg={makeResult.error} />}
          {makeResult?.cocktails && (
            <CocktailResults cocktails={makeResult.cocktails}
              onSave={c => setCocktailFavs(f => [{ ...c, savedAt: new Date().toISOString() }, ...f])}
              onMake={openGuidedMaker} />
          )}
        </Modal>
      )}

      {/* Guided Cocktail Maker */}
      {showGuidedMaker && guidedCocktail && (
        <Modal onClose={() => setShowGuidedMaker(false)}
          title="⚖ Guided Cocktail Maker">
          <GuidedCocktailMaker
            cocktail={guidedCocktail}
            cellar={cellar}
            unitPref={unitPref}
            onClose={() => setShowGuidedMaker(false)}
            onLogPour={(cocktail, steps) => {
              const entry = {
                id: Date.now(),
                bottle_name: cocktail.name,
                bottle_id: null,
                category: 'Cocktail',
                poured_oz: steps.reduce((s, st) => s + (st.grams || 0) / 29.5735, 0),
                poured_ml: steps.reduce((s, st) => s + (st.grams || 0), 0),
                poured_g:  steps.reduce((s, st) => s + (st.grams || 0), 0),
                poured_at: new Date().toISOString(),
              }
              setPourLog(l => [entry, ...l.slice(0, 499)])
            }}
          />
        </Modal>
      )}

      {/* What Can I Make? */}
      {showDiscoverModal && (
        <Modal onClose={() => setShowDiscoverModal(false)} title="✨ What Can I Make?">
          {discoverLoading && <LoadingSpinner text="Scanning your cellar for cocktail possibilities…" />}
          {discoverResult?.error && <ErrorMsg msg={discoverResult.error} />}
          {discoverResult?.cocktails && (
            <>
              {discoverResult.tip && (
                <div style={{ ...bCard({ marginBottom: 16, background: C.surface }),
                  fontFamily: FM, fontSize: 12, color: C.gold }}>
                  💡 {discoverResult.tip}
                </div>
              )}
              <CocktailResults cocktails={discoverResult.cocktails} showMissing
                onSave={c => setCocktailFavs(f => [{ ...c, savedAt: new Date().toISOString() }, ...f])}
                onMake={openGuidedMaker} />
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

// -- Modal wrapper -------------------------------------------------------------
function Modal({ onClose, title, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 650, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
        borderRadius: 18, padding: 24, maxWidth: 520, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: 'var(--sc-burgundy)', fontWeight: 700 }}>
            {title}
          </div>
          <button onClick={onClose} style={{
            background: 'var(--sc-surface)', border: '1px solid var(--sc-border)',
            borderRadius: 6, color: 'var(--sc-text)', cursor: 'pointer', fontSize: 15, padding: '3px 9px',
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// -- Bottle Card ---------------------------------------------------------------
function BottleCard({ bottle, onEdit, onDelete, onPour, onMake, unitPref, seniorMode = false }) {
  const pct = bottle.remaining_pct ?? 100
  const catColor = CAT_COLORS[bottle.category] || 'var(--sc-muted)'
  const isLow = pct < 20

  return (
    <div style={{
      background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
      borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.15s',
    }}>

      {/* Bottle photo banner — shown if captured during scan */}
      {bottle.photo_b64 && (
        <div style={{ position: 'relative', width: '100%', height: 160, overflow: 'hidden', flexShrink: 0 }}>
          <img
            src={`data:image/jpeg;base64,${bottle.photo_b64}`}
            alt={bottle.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
            background: 'linear-gradient(transparent, var(--sc-card))',
          }} />
          <div style={{
            position: 'absolute', top: 8, right: 8,
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
            color: catColor, background: 'rgba(0,0,0,0.75)', borderRadius: 6,
            padding: '3px 8px', backdropFilter: 'blur(4px)',
          }}>
            {bottle.category}
          </div>
        </div>
      )}

      {/* Card body */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Top row: name + category badge (badge hidden when photo present) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: seniorMode ? 30 : 18, fontWeight: 700,
              color: 'var(--sc-text)', lineHeight: 1.2, marginBottom: 2 }}>
              {bottle.name}
            </div>
            {(bottle.producer || bottle.brand) && (
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)' }}>
                {bottle.producer || bottle.brand}
              </div>
            )}
          </div>
          {!bottle.photo_b64 && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
              color: catColor, background: catColor + '18', borderRadius: 6,
              padding: '3px 8px', whiteSpace: 'nowrap', marginLeft: 8,
            }}>
              {bottle.category}
            </div>
          )}
        </div>

        {/* Fill level bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--sc-muted)' }}>
              {bottle.size_ml || 750}ml bottle
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
              color: isLow ? 'var(--sc-red)' : 'var(--sc-text)' }}>
              {Math.round(pct)}% {isLow ? '⚠ Low' : 'remaining'}
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--sc-border)', borderRadius: 3 }}>
            <div style={{
              height: '100%', width: pct + '%', borderRadius: 3,
              background: isLow ? 'var(--sc-red)' : catColor,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* Meta tags */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {bottle.proof && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--sc-muted)',
              background: 'var(--sc-surface)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--sc-border)' }}>
              {bottle.proof}° proof
            </span>
          )}
          {bottle.vintage && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--sc-muted)',
              background: 'var(--sc-surface)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--sc-border)' }}>
              {bottle.vintage}
            </span>
          )}
          {bottle.sweetness && isWineCategory(bottle.category) && (() => {
            const sw = WINE_SWEETNESS.find(s => s.value === bottle.sweetness)
            return (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700,
                background: (sw?.color || 'var(--sc-muted)') + '22',
                color: sw?.color || 'var(--sc-muted)',
                borderRadius: 4, padding: '2px 7px', border: `1px solid ${sw?.color || 'var(--sc-border)'}44` }}>
                {bottle.sweetness}
              </span>
            )
          })()}
          {bottle.location && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--sc-muted)',
              background: 'var(--sc-surface)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--sc-border)' }}>
              📍 {bottle.location}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={onPour} style={{ ...bBtn('primary', { flex: 1, fontSize: seniorMode ? 20 : 12, padding: seniorMode ? '16px 10px' : '7px 10px' }) }}>
            ⚖ Pour
          </button>
          <button onClick={onMake} style={{ ...bBtn('gold', { flex: 1, fontSize: seniorMode ? 20 : 12, padding: seniorMode ? '16px 10px' : '7px 10px' }) }}>
            🍹 Make
          </button>
          <button onClick={onEdit} style={{ ...bBtn('ghost', { fontSize: 12, padding: '7px 10px' }) }}>✏</button>
          <button onClick={onDelete} style={{ ...bBtn('danger', { fontSize: 12, padding: '7px 10px' }) }}>🗑</button>
        </div>

        {/* Producer search link — uses producer field, falls back to brand, then name */}
        {(bottle.producer || bottle.brand || bottle.name) && (() => {
          const producer = bottle.producer || bottle.brand || bottle.name
          const searchTerm = encodeURIComponent(producer)
          const searchUrl = `https://www.google.com/search?q=${searchTerm}`
          return (
            <a href={searchUrl} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: 'var(--sc-teal)', textDecoration: 'none',
                background: 'var(--sc-teal)10', border: '1px solid var(--sc-teal)33',
                borderRadius: 8, padding: '6px 10px',
              }}>
              🔍 <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Search {producer}
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.7 }}>↗</span>
            </a>
          )
        })()}

      </div>{/* end card body */}
    </div>
  )
}


// -- Bottle Form ---------------------------------------------------------------
function BottleForm({ form, onChange }) {
  const fi = (field) => ({
    width: '100%', background: 'var(--sc-surface)', border: '1px solid var(--sc-border)',
    borderRadius: 8, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif", fontSize: 13,
    padding: '9px 12px', outline: 'none', marginBottom: 12,
  })
  const label = (txt) => (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 600,
      color: 'var(--sc-muted)', marginBottom: 4 }}>
      {txt}
    </div>
  )

  return (
    <div>
      {label('Bottle Name *')}
      <input style={fi()} placeholder="e.g. Maker's Mark" value={form.name || ''}
        onChange={e => onChange({ name: e.target.value })} />

      {label('Category')}
      <select style={{ ...fi(), cursor: 'pointer' }} value={form.category || ''}
        onChange={e => onChange({ category: e.target.value })}>
        {SPIRIT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
      </select>

      {label('Brand')}
      <input style={fi()} placeholder="e.g. Catherman's Port" value={form.brand || ''}
        onChange={e => onChange({ brand: e.target.value })} />

      {label('Vineyard / Winery / Distillery')}
      <input style={fi()} placeholder="e.g. St. Julian Winery" value={form.producer || ''}
        onChange={e => onChange({ producer: e.target.value })} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          {label('Size (ml)')}
          <select style={{ ...fi(), cursor: 'pointer' }} value={form.size_ml || 750}
            onChange={e => onChange({ size_ml: +e.target.value })}>
            {[50, 200, 375, 500, 750, 1000, 1750].map(s => <option key={s} value={s}>{s}ml</option>)}
          </select>
        </div>
        <div>
          {label('Remaining %')}
          <input style={fi()} type="number" min={0} max={100} value={form.remaining_pct ?? 100}
            onChange={e => onChange({ remaining_pct: Math.min(100, Math.max(0, +e.target.value)) })} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          {label('Proof (optional)')}
          <input style={fi()} placeholder="e.g. 90" value={form.proof || ''}
            onChange={e => onChange({ proof: e.target.value })} />
        </div>
        <div>
          {label('Vintage / Year')}
          <input style={fi()} placeholder="e.g. 2019" value={form.vintage || ''}
            onChange={e => onChange({ vintage: e.target.value })} />
        </div>
      </div>

      {/* Wine sweetness — only shown for wine categories */}
      {isWineCategory(form.category) && (
        <div style={{ marginBottom: 0 }}>
          {label('Sweetness Level')}
          <select style={{ ...fi(), cursor: 'pointer' }} value={form.sweetness || ''}
            onChange={e => onChange({ sweetness: e.target.value })}>
            {WINE_SWEETNESS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {label('Location')}
      <select style={{ ...fi(), cursor: 'pointer' }} value={form.location || 'Bar Cart'}
        onChange={e => onChange({ location: e.target.value })}>
        {['Bar Cart', 'Home Bar', 'Wine Rack', 'Cellar', 'Cabinet', 'Fridge', 'Garage'].map(l =>
          <option key={l}>{l}</option>)}
      </select>

      {label('Notes')}
      <textarea style={{ ...fi(), resize: 'vertical', minHeight: 60 }}
        placeholder="Tasting notes, gift info, etc."
        value={form.notes || ''} onChange={e => onChange({ notes: e.target.value })} />

      {label('Bottle Photo (optional)')}
      <div style={{ marginBottom: 12 }}>
        {form.photo_b64 ? (
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', marginBottom: 6 }}>
            <img src={`data:image/jpeg;base64,${form.photo_b64}`} alt="Bottle"
              style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', borderRadius: 8 }} />
            <button onClick={() => onChange({ photo_b64: null })}
              style={{ position: 'absolute', top: 6, right: 6, background: '#000a', border: 'none',
                color: '#fff', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', fontSize: 12 }}>
              ✕
            </button>
          </div>
        ) : (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            background: 'var(--sc-surface)', border: '1px dashed var(--sc-border)',
            borderRadius: 8, padding: '10px 14px',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--sc-muted)',
          }}>
            📷 Tap to add bottle photo
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={async e => {
                const file = e.target.files[0]
                if (!file) return
                const b64 = await fileToBase64(file)
                onChange({ photo_b64: b64 })
              }} />
          </label>
        )}
      </div>
    </div>
  )
}

// -- Pour Modal ----------------------------------------------------------------
function PourModal({ bottle, scale, phase, targetOz, setTargetOz, onTare, onFinish, onDone,
  pourResult, unitPref, LivePourProgress, PourFillGraphic }) {

  return (
    <div>
      {/* Bottle info */}
      <div style={{
        background: 'var(--sc-surface)', borderRadius: 10, padding: '10px 14px',
        marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-text)' }}>
          {bottle.name}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--sc-muted)' }}>
          {bottle.category}
        </div>
      </div>

      {/* Browser / scale status */}
      {!scale.browserOK && (
        <div style={{ background: '#dc262612', border: '1px solid #dc262644', borderRadius: 10,
          padding: 12, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: '#dc2626', lineHeight: 1.5 }}>
          ⚠ Web Bluetooth requires Chrome or Edge on Android, Windows, or Mac. Not supported on iOS Safari.
        </div>
      )}

      {/* Phase: connect */}
      {phase === 'tare' && !scale.isConnected && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚖</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)',
            marginBottom: 20, lineHeight: 1.6 }}>
            Place your glass on the Etekcity scale, then connect.
          </div>

          {/* Target pour selector */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)',
              marginBottom: 8 }}>Pour Target</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {POUR_PRESETS.map(p => (
                <button key={p.oz} onClick={() => setTargetOz(p.oz)}
                  style={{
                    ...bBtn('ghost'), fontSize: 11, padding: '5px 10px',
                    borderColor: targetOz === p.oz ? 'var(--sc-teal)' : 'var(--sc-border)',
                    color: targetOz === p.oz ? 'var(--sc-teal)' : 'var(--sc-muted)',
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={scale.connect} disabled={scale.connecting || !scale.browserOK}
            style={{ ...bBtn('teal'), padding: '12px 28px', fontSize: 14,
              opacity: !scale.browserOK ? 0.5 : 1 }}>
            {scale.connecting ? 'Searching…' : '⚖ Connect Scale'}
          </button>
          {scale.error && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#dc2626', marginTop: 12 }}>
              {scale.error}
            </div>
          )}
        </div>
      )}

      {/* Phase: tare (connected, ready to zero) */}
      {phase === 'tare' && scale.isConnected && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-teal)',
            fontWeight: 700, marginBottom: 12 }}>SCALE CONNECTED</div>

          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 42, color: 'var(--sc-text)',
            lineHeight: 1, marginBottom: 4 }}>
            {scale.weight !== null ? scale.weight?.toFixed(1) : '---'}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: 'var(--sc-muted)', marginBottom: 20 }}>
            {scale.unit}
          </div>

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--sc-muted)',
            marginBottom: 20, lineHeight: 1.6 }}>
            Place empty glass on scale, then tap <strong style={{ color: 'var(--sc-text)' }}>Tare & Start Pour</strong> to zero.
          </div>

          <button onClick={onTare} style={{ ...bBtn('primary'), padding: '12px 28px', fontSize: 14 }}>
            ⚖ Tare & Start Pour
          </button>
        </div>
      )}

      {/* Phase: pouring */}
      {phase === 'pouring' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-gold)',
            fontWeight: 700, marginBottom: 16 }}>POUR NOW</div>
          <LivePourProgress />
          <button onClick={onFinish} style={{ ...bBtn('gold'), padding: '12px 28px', fontSize: 14, marginTop: 20 }}>
            ✓ Done Pouring
          </button>
          <button onClick={scale.tare} style={{ ...bBtn('ghost'), fontSize: 12, padding: '7px 14px',
            marginTop: 10, marginLeft: 8 }}>
            ↺ Re-tare
          </button>
        </div>
      )}

      {/* Phase: done */}
      {phase === 'done' && pourResult && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🥂</div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)', marginBottom: 4 }}>
            {unitPref === 'oz' ? pourResult.poured_oz.toFixed(2) + ' oz' : pourResult.poured_ml.toFixed(1) + ' ml'}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)', marginBottom: 20 }}>
            {pourResult.poured_g}g recorded · {new Date(pourResult.poured_at).toLocaleTimeString()}
          </div>
          <PourFillGraphic poured_oz={pourResult.poured_oz} target_oz={targetOz} category={bottle.category} />
          <button onClick={onDone} style={{ ...bBtn('teal'), padding: '12px 28px', fontSize: 14, marginTop: 20 }}>
            Done
          </button>
        </div>
      )}

      {/* Setup note */}
      <div style={{ background: 'var(--sc-surface)', borderRadius: 10, padding: 12, marginTop: 20 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
          color: 'var(--sc-text)', marginBottom: 4 }}>Compatible Scale</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)', lineHeight: 1.5 }}>
          Etekcity Nutrition Scale <strong style={{ color: 'var(--sc-text)' }}>ENS-L221S</strong> — confirmed BLE (FFF0/FFF1/FFF2).
          Search "Etekcity Nutrition Scale ENS-L221S" on Amazon.
        </div>
      </div>
    </div>
  )
}

// -- Pour & Track View (standalone nav view) ----------------------------------
function PourTrackView({ cellar, scale, unitPref, onOpenPour }) {
  return (
    <div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)',
        marginBottom: 8 }}>Pour & Track</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)',
        marginBottom: 24 }}>
        Select a bottle, connect your Etekcity Bluetooth scale, and track every pour with precision.
      </div>
      {cellar.length === 0 ? (
        <div style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)', borderRadius: 14,
          padding: 48, textAlign: 'center' }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)' }}>
            Add bottles to your cellar first, then return here to pour.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {cellar.map(b => (
            <div key={b.id} style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
              borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between',
              alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontWeight: 700,
                  color: 'var(--sc-text)' }}>{b.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-muted)' }}>{b.category} · {Math.round(b.remaining_pct ?? 100)}%</div>
              </div>
              <button onClick={() => onOpenPour(b)} style={{ ...bBtn('primary', { fontSize: 12, padding: '8px 14px' }) }}>
                ⚖ Pour
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Make a Drink View ---------------------------------------------------------
function MakeADrinkView({ cellar, onMake }) {
  return (
    <div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)',
        marginBottom: 8 }}>Make a Drink</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)',
        marginBottom: 24 }}>
        Choose a spirit and your AI bartender will craft cocktail recipes from your cellar.
      </div>
      {cellar.length === 0 ? (
        <div style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)', borderRadius: 14,
          padding: 48, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: 'var(--sc-muted)' }}>
          Add bottles to your cellar first.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {cellar.map(b => (
            <div key={b.id} style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
              borderRadius: 14, padding: 16, display: 'flex', justifyContent: 'space-between',
              alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontWeight: 700,
                  color: 'var(--sc-text)' }}>{b.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-muted)' }}>{b.category}</div>
              </div>
              <button onClick={() => onMake(b)} style={{ ...bBtn('gold', { fontSize: 12, padding: '8px 14px' }) }}>
                🍹 Make
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Discover View -------------------------------------------------------------
function DiscoverView({ onDiscover, query, setQuery }) {
  return (
    <div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)',
        marginBottom: 8 }}>What Can I Make?</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)',
        marginBottom: 24 }}>
        Your AI bartender scans your full cellar and finds the best cocktails you can make right now.
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input placeholder='Optional: "something refreshing" or "whiskey sour variation"'
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onDiscover(query)}
          style={{
            flex: 1, background: 'var(--sc-surface)', border: '1px solid var(--sc-border)',
            borderRadius: 8, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
            fontSize: 13, padding: '9px 12px', outline: 'none',
          }} />
        <button onClick={() => onDiscover(query)} style={{ ...bBtn('teal', { padding: '9px 20px' }) }}>
          ✨ Discover
        </button>
        <button onClick={() => { setQuery(''); onDiscover('') }} style={{ ...bBtn('ghost', { fontSize: 12 }) }}>
          🎲 Surprise Me
        </button>
      </div>
    </div>
  )
}

// -- DIY View ------------------------------------------------------------------
function DIYView() {
  const guides = [
    { name: 'Simple Syrup', emoji: '🧪', difficulty: 'Easy', time: '10 min',
      ingredients: ['1 cup sugar', '1 cup water'],
      steps: ['Combine sugar and water in a saucepan.', 'Heat over medium, stirring until sugar dissolves completely (do not boil).', 'Cool, bottle, refrigerate. Keeps 4 weeks.'],
      notes: 'Use 2:1 ratio (2 cups sugar : 1 cup water) for rich simple syrup — preferred by most bartenders.' },
    { name: 'Grenadine', emoji: '🌹', difficulty: 'Easy', time: '20 min',
      ingredients: ['1 cup pomegranate juice (100% pure)', '1 cup sugar', '1 oz pomegranate molasses (optional)', '1 tsp orange blossom water (optional)'],
      steps: ['Heat pomegranate juice and sugar over medium heat, stirring until dissolved.', 'Add molasses and orange blossom water if using.', 'Cool, bottle, refrigerate up to 6 weeks.'],
      notes: 'Real grenadine is far superior to store-bought. The molasses adds depth; orange blossom adds floral complexity.' },
    { name: 'Aromatic Bitters', emoji: '🌿', difficulty: 'Advanced', time: '2–4 weeks',
      ingredients: ['2 oz gentian root', '1 oz cinchona bark', '1 tsp cardamom', '1 tsp cloves', '1 tsp allspice', 'Zest of 1 orange', '2 cups high-proof vodka or grain spirits'],
      steps: ['Combine all botanicals in a sealed jar.', 'Add spirits, seal, and store in a cool dark place.', 'Agitate daily for 2 weeks.', 'Strain through cheesecloth, then coffee filter.', 'Add a few drops to a glass of water to check intensity — dilute if too strong.'],
      notes: 'Start with this base and tweak with spices each batch. Labeling your batches with dates is highly recommended.' },
    { name: 'Honey Syrup', emoji: '🍯', difficulty: 'Easy', time: '5 min',
      ingredients: ['3 parts honey', '1 part hot water'],
      steps: ['Gently warm honey (microwave or stovetop) until fluid.', 'Stir in hot water until fully combined.', 'Bottle, refrigerate up to 3 weeks.'],
      notes: 'Essential for a Bees Knees, Gold Rush, and Penicillin. Use local wildflower honey for best flavor.' },
    { name: 'Falernum', emoji: '🌺', difficulty: 'Medium', time: '1 week',
      ingredients: ['Zest of 6 limes', '1 oz grated fresh ginger', '1 cup almonds (blanched)', '4 whole cloves', '12 allspice berries', '2 cups rum (overproof preferred)', '1 cup sugar', '½ cup water'],
      steps: ['Toast almonds in dry pan until lightly golden.', 'Combine zests, ginger, cloves, allspice, and almonds with rum. Seal and wait 24 hours.', 'Make simple syrup with sugar and water.', 'Strain the infusion, combine with syrup and almond extract.', 'Bottle and refrigerate up to 2 months.'],
      notes: 'Core ingredient for Trader Vic-era tiki drinks. Absolutely transforms a Dark and Stormy or Zombie.' },
  ]

  const [expanded, setExpanded] = useState(null)

  return (
    <div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)',
        marginBottom: 8 }}>DIY Craft Ingredients</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--sc-muted)',
        marginBottom: 24, lineHeight: 1.6 }}>
        Elevate your bar with house-made syrups, bitters, and liqueurs. These guides walk you through
        everything from simple syrup to classic falernum.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {guides.map((g, i) => (
          <div key={g.name} style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
            borderRadius: 14, overflow: 'hidden' }}>
            <button onClick={() => setExpanded(expanded === i ? null : i)}
              style={{ width: '100%', background: 'none', border: 'none', padding: '16px 20px',
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>{g.emoji}</span>
                <div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18,
                    fontWeight: 700, color: 'var(--sc-text)' }}>{g.name}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                    color: 'var(--sc-muted)' }}>
                    {g.difficulty} · {g.time}
                  </div>
                </div>
              </div>
              <span style={{ color: 'var(--sc-muted)', fontSize: 18 }}>
                {expanded === i ? '▲' : '▼'}
              </span>
            </button>
            {expanded === i && (
              <div style={{ padding: '0 20px 20px' }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                    fontWeight: 700, color: 'var(--sc-gold)', marginBottom: 8 }}>INGREDIENTS</div>
                  {g.ingredients.map((ing, j) => (
                    <div key={j} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                      color: 'var(--sc-text)', padding: '4px 0',
                      borderBottom: j < g.ingredients.length - 1 ? '1px solid var(--sc-border)' : 'none' }}>
                      • {ing}
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                    fontWeight: 700, color: 'var(--sc-teal)', marginBottom: 8 }}>STEPS</div>
                  {g.steps.map((step, j) => (
                    <div key={j} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                      color: 'var(--sc-text)', padding: '6px 0', display: 'flex', gap: 10,
                      borderBottom: j < g.steps.length - 1 ? '1px solid var(--sc-border)' : 'none' }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                        color: 'var(--sc-burgundy)', fontWeight: 700, minWidth: 18 }}>{j + 1}.</span>
                      {step}
                    </div>
                  ))}
                </div>
                {g.notes && (
                  <div style={{ background: 'var(--sc-surface)', borderRadius: 8, padding: 12,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)',
                    lineHeight: 1.6 }}>
                    💡 {g.notes}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// -- Pour Log View -------------------------------------------------------------
function PourLogView({ pourLog, unitPref, onClear }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, color: 'var(--sc-text)' }}>
          Pour Log
        </div>
        {pourLog.length > 0 && (
          <button onClick={() => { if (confirm('Clear all pour history?')) onClear() }}
            style={{ ...bBtn('danger', { fontSize: 12 }) }}>Clear Log</button>
        )}
      </div>
      {pourLog.length === 0 ? (
        <div style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)', borderRadius: 14,
          padding: 48, textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: 'var(--sc-muted)' }}>
          No pours logged yet. Use ⚖ Pour & Track to start.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pourLog.map(entry => (
            <div key={entry.id} style={{ background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
              borderRadius: 10, padding: '12px 16px', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16,
                  fontWeight: 700, color: 'var(--sc-text)' }}>{entry.bottle_name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-muted)' }}>
                  {new Date(entry.poured_at).toLocaleString()}
                </div>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
                color: 'var(--sc-burgundy)', fontWeight: 700 }}>
                {unitPref === 'oz' ? entry.poured_oz + ' oz' : entry.poured_ml + ' ml'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Cocktail Results ---------------------------------------------------------
function CocktailResults({ cocktails, showMissing = false, onSave }) {
  const [saved, setSaved] = useState(new Set())
  const [expanded, setExpanded] = useState(0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {cocktails.map((c, i) => (
        <div key={i} style={{ background: 'var(--sc-surface)', border: '1px solid var(--sc-border)',
          borderRadius: 14, overflow: 'hidden' }}>
          <button onClick={() => setExpanded(expanded === i ? null : i)}
            style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px',
              cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18,
                  fontWeight: 700, color: 'var(--sc-text)' }}>{c.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-muted)', marginTop: 2 }}>
                  {c.difficulty} · {c.glassware}
                </div>
              </div>
              {showMissing && c.missing?.length > 0 && (
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-amber)', background: 'var(--sc-amber)18', borderRadius: 6,
                  padding: '2px 8px' }}>
                  Need {c.missing.length} item{c.missing.length > 1 ? 's' : ''}
                </span>
              )}
              {(!showMissing || !c.missing?.length) && (
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  color: 'var(--sc-teal)', background: 'var(--sc-teal)18', borderRadius: 6,
                  padding: '2px 8px' }}>
                  ✓ Can make now
                </span>
              )}
            </div>
          </button>

          {expanded === i && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                color: 'var(--sc-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                {c.description}
              </div>

              {/* Ingredients */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  fontWeight: 700, color: 'var(--sc-gold)', marginBottom: 6 }}>INGREDIENTS</div>
                {c.ingredients?.map((ing, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between',
                    padding: '4px 0', borderBottom: '1px solid var(--sc-border)',
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    <span style={{ color: showMissing && ing.in_cellar === false ? 'var(--sc-amber)' : 'var(--sc-text)' }}>
                      {showMissing && ing.in_cellar === false ? '⚠ ' : ''}{ing.item}
                    </span>
                    <span style={{ color: 'var(--sc-muted)' }}>{ing.amount}</span>
                  </div>
                ))}
              </div>

              {/* Steps */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                  fontWeight: 700, color: 'var(--sc-teal)', marginBottom: 6 }}>METHOD</div>
                {c.steps?.map((step, j) => (
                  <div key={j} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13,
                    color: 'var(--sc-text)', padding: '5px 0', display: 'flex', gap: 8,
                    borderBottom: j < c.steps.length - 1 ? '1px solid var(--sc-border)' : 'none' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                      color: 'var(--sc-burgundy)', fontWeight: 700, minWidth: 16 }}>{j + 1}.</span>
                    {step}
                  </div>
                ))}
              </div>

              {c.garnish && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'var(--sc-muted)', marginBottom: 10 }}>
                  🍋 Garnish: {c.garnish}
                </div>
              )}
              {c.tasting_notes && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'var(--sc-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                  👃 {c.tasting_notes}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { onSave(c); setSaved(s => new Set([...s, i])) }}
                  disabled={saved.has(i)}
                  style={{ ...bBtn(saved.has(i) ? 'ghost' : 'primary', { fontSize: 12, padding: '7px 16px' }),
                    opacity: saved.has(i) ? 0.6 : 1 }}>
                  {saved.has(i) ? '✓ Saved' : '♡ Save Recipe'}
                </button>
                {onMake && (
                  <button onClick={() => onMake(c)}
                    style={{ ...bBtn('teal', { fontSize: 12, padding: '7px 16px' }) }}>
                    ⚖ Make This
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// -- Loading Spinner -----------------------------------------------------------
function LoadingSpinner({ text }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      <div style={{ fontSize: 32, marginBottom: 12,
        animation: 'sc-spin 1s linear infinite', display: 'inline-block' }}>🍹</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--sc-muted)' }}>
        {text}
      </div>
    </div>
  )
}

// -- Error msg -----------------------------------------------------------------
function ErrorMsg({ msg }) {
  return (
    <div style={{ background: '#dc262612', border: '1px solid #dc262644', borderRadius: 10,
      padding: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#dc2626' }}>
      {msg}
    </div>
  )
}

// bBtn, bInp, bCard, loadLS, saveLS, SPIRIT_CATEGORIES, CAT_COLORS, POUR_PRESETS
// are all defined at module level above and shared across all sub-components.

// =============================================================================
// SCANNER MODAL COMPONENT
// Mirrors Smart Kitchen scan pattern — bottle photo, receipt, manual fallback
// =============================================================================
function ScannerModal({
  scanMode, setScanMode, scanStage, setScanStage,
  scanPreview, scanB64, scanResults, setScanResults,
  onFile, onAnalyzeBottle, onAnalyzeReceipt, onCommit, onClose, onManual,
  fileRef, galleryRef,
}) {
  const SPIRIT_CATS = [
    'Whiskey / Bourbon','Scotch','Rye','Irish Whiskey','Vodka','Gin','Rum',
    'Tequila / Mezcal','Brandy / Cognac','Liqueur / Cordial','Amaro / Bitters',
    'Wine — Red','Wine — White','Wine — Rosé','Wine — Sparkling',
    'Beer / Hard Cider','Hard Seltzer','Non-Alcoholic','Mixers','Syrups & Modifiers',
    'Bartesian Pods','Other',
  ]

  // -- UPLOAD STAGE -----------------------------------------------------------
  if (scanStage === 'upload') return (
    <div>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'bottle',  label: '📷 Bottle Photo' },
          { id: 'receipt', label: '🧾 Receipt' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setScanMode(id)}
            style={{
              flex: 1, padding: '10px', borderRadius: 9, cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
              border: `1px solid ${scanMode === id ? 'var(--sc-burgundy)' : 'var(--sc-border)'}`,
              background: scanMode === id ? 'var(--sc-burgundy)22' : 'transparent',
              color: scanMode === id ? 'var(--sc-burgundy)' : 'var(--sc-muted)',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Context hint */}
      <div style={{
        background: 'var(--sc-surface)', borderRadius: 10, padding: '10px 14px',
        marginBottom: 14, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
        color: 'var(--sc-muted)', lineHeight: 1.6,
      }}>
        {scanMode === 'bottle'
          ? '📷 Point camera at the front label of any bottle. Works with spirits, wine, beer, and mixers. Multiple bottles in one shot OK.'
          : '🧾 Photograph your liquor store or wine shop receipt. Smart Cellar will extract every bottle purchased and add them all at once.'}
      </div>

      {/* Drop zone — tap to camera, button for gallery */}
      <div onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${scanPreview ? 'var(--sc-burgundy)' : 'var(--sc-border)'}`,
          borderRadius: 14, cursor: 'pointer', overflow: 'hidden',
          minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: scanPreview ? 'transparent' : 'var(--sc-surface)', marginBottom: 14,
        }}>
        {scanPreview ? (
          <div style={{ position: 'relative', width: '100%' }}>
            <img src={scanPreview} alt="" style={{
              width: '100%', display: 'block', borderRadius: 12,
              maxHeight: 260, objectFit: 'contain',
            }} />
            <button onClick={e => { e.stopPropagation(); onFile(null) }}
              style={{
                position: 'absolute', top: 8, right: 8, background: '#000a',
                border: 'none', color: '#fff', borderRadius: '50%',
                width: 28, height: 28, cursor: 'pointer', fontSize: 14,
              }}>✕</button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>
              {scanMode === 'bottle' ? '🍾' : '🧾'}
            </div>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif", fontSize: 18,
              color: 'var(--sc-text)', marginBottom: 4,
            }}>
              {scanMode === 'bottle' ? 'Tap to photograph bottle' : 'Tap to photograph receipt'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--sc-muted)', marginBottom: 14 }}>
              opens camera directly
            </div>
            <button onClick={e => { e.stopPropagation(); galleryRef.current?.click() }}
              style={{
                background: 'transparent', border: '1px solid var(--sc-border)',
                borderRadius: 8, color: 'var(--sc-muted)', cursor: 'pointer',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, padding: '6px 16px',
              }}>
              Choose from Gallery
            </button>
          </div>
        )}
      </div>

      {/* Hidden file inputs — camera and gallery */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />
      <input ref={galleryRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={e => onFile(e.target.files[0])} />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onManual}
          style={{
            flex: 1, padding: '10px', borderRadius: 9,
            border: '1px solid var(--sc-border)', background: 'transparent',
            color: 'var(--sc-muted)', cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600,
          }}>
          ✏ Manual Entry
        </button>
        <button
          onClick={scanMode === 'receipt' ? onAnalyzeReceipt : onAnalyzeBottle}
          disabled={!scanB64}
          style={{
            flex: 2, padding: '10px', borderRadius: 9, border: 'none',
            background: scanB64 ? 'var(--sc-burgundy)' : 'var(--sc-border)',
            color: scanB64 ? '#fff' : 'var(--sc-muted)',
            cursor: scanB64 ? 'pointer' : 'not-allowed',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
            opacity: scanB64 ? 1 : 0.5,
          }}>
          {scanMode === 'bottle' ? '🔍 Identify Bottle' : '🧾 Read Receipt'}
        </button>
      </div>
    </div>
  )

  // -- ANALYZING STAGE --------------------------------------------------------
  if (scanStage === 'analyzing') return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      {scanPreview && (
        <img src={scanPreview} alt="" style={{
          width: '100%', borderRadius: 10, maxHeight: 200,
          objectFit: 'contain', opacity: 0.5, marginBottom: 20,
        }} />
      )}
      <div style={{ fontSize: 40, marginBottom: 12,
        animation: 'sc-spin 1.2s linear infinite', display: 'inline-block' }}>🍾</div>
      <div style={{
        fontFamily: "'Cormorant Garamond', serif", fontSize: 22,
        color: 'var(--sc-burgundy)', marginBottom: 8,
      }}>
        {scanMode === 'bottle' ? 'Identifying bottle…' : 'Reading receipt…'}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'var(--sc-muted)' }}>
        This takes about 10–15 seconds
      </div>
    </div>
  )

  // -- REVIEW STAGE -----------------------------------------------------------
  if (scanStage === 'review' && scanResults) {
    const selectedCount = scanResults.filter(b => b.selected).length
    return (
      <div>
        {/* Thumbnail */}
        {scanPreview && (
          <img src={scanPreview} alt="" style={{
            width: '100%', borderRadius: 8, maxHeight: 80,
            objectFit: 'cover', marginBottom: 12, opacity: 0.6,
          }} />
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--sc-muted)' }}>
            {selectedCount} of {scanResults.length} bottle{scanResults.length !== 1 ? 's' : ''} selected
          </div>
          <button onClick={() => setScanResults(r => {
            const allSelected = r.every(b => b.selected)
            return r.map(b => ({ ...b, selected: !allSelected }))
          })} style={{
            background: 'none', border: '1px solid var(--sc-border)', borderRadius: 6,
            color: 'var(--sc-muted)', cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10, padding: '3px 10px',
          }}>
            {scanResults.every(b => b.selected) ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {/* Bottle cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto', marginBottom: 14 }}>
          {scanResults.map((bottle, i) => (
            <div key={bottle.id || i} style={{
              background: bottle.selected ? 'var(--sc-surface)' : 'var(--sc-card)',
              border: `1px solid ${bottle.selected ? 'var(--sc-burgundy)' : 'var(--sc-border)'}`,
              borderRadius: 12, padding: '12px 14px',
            }}>
              {/* Row 1: checkbox + name + confidence */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                cursor: 'pointer' }}
                onClick={() => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, selected: !b.selected } : b))}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                  border: `2px solid ${bottle.selected ? 'var(--sc-teal)' : 'var(--sc-border)'}`,
                  background: bottle.selected ? 'var(--sc-teal)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#0c0e14', fontWeight: 700,
                }}>
                  {bottle.selected && '✓'}
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    value={bottle.name || ''}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, name: e.target.value } : b))}
                    style={{
                      width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                      borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 15, fontWeight: 700, padding: '4px 8px', outline: 'none',
                    }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
                    padding: '2px 7px', borderRadius: 6,
                    background: bottle.confidence === 'high' ? 'var(--sc-teal)22' : bottle.confidence === 'low' ? 'var(--sc-red)22' : 'var(--sc-amber)22',
                    color: bottle.confidence === 'high' ? 'var(--sc-teal)' : bottle.confidence === 'low' ? 'var(--sc-red)' : 'var(--sc-amber)',
                  }}>
                    {bottle.confidence === 'high' ? '✓ HIGH' : bottle.confidence === 'low' ? '⚠ LOW' : '● MED'}
                  </span>
                  {/* Photo will be saved with this bottle */}
                  {scanB64 && (
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-burgundy)', background: 'var(--sc-burgundy)18',
                      borderRadius: 4, padding: '2px 6px' }}>
                      📷 photo
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: editable fields */}
              {bottle.selected && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
                  onClick={e => e.stopPropagation()}>
                  {/* Category */}
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-muted)', marginBottom: 3 }}>CATEGORY</div>
                    <select value={bottle.category || 'Other'}
                      onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, category: e.target.value } : b))}
                      style={{
                        width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                        borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
                        fontSize: 11, padding: '5px 8px', outline: 'none',
                      }}>
                      {SPIRIT_CATS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  {/* Size */}
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-muted)', marginBottom: 3 }}>SIZE</div>
                    <select value={bottle.size_ml || 750}
                      onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, size_ml: +e.target.value } : b))}
                      style={{
                        width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                        borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
                        fontSize: 11, padding: '5px 8px', outline: 'none',
                      }}>
                      {[50,200,375,500,750,1000,1750].map(s => <option key={s} value={s}>{s}ml</option>)}
                    </select>
                  </div>
                  {/* Proof */}
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-muted)', marginBottom: 3 }}>PROOF</div>
                    <input value={bottle.proof || ''}
                      onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, proof: e.target.value } : b))}
                      placeholder="e.g. 90"
                      style={{
                        width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                        borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
                        fontSize: 11, padding: '5px 8px', outline: 'none', boxSizing: 'border-box',
                      }} />
                  </div>
                  {/* Sweetness — wine only */}
                  {isWineCategory(bottle.category) && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                        color: 'var(--sc-muted)', marginBottom: 3 }}>SWEETNESS</div>
                      <select value={bottle.sweetness || ''}
                        onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, sweetness: e.target.value } : b))}
                        style={{
                          width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                          borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
                          fontSize: 11, padding: '5px 8px', outline: 'none',
                        }}>
                        {WINE_SWEETNESS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Location */}
                  <div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-muted)', marginBottom: 3 }}>LOCATION</div>
                    <select value={bottle.location || 'Bar Cart'}
                      onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, location: e.target.value } : b))}
                      style={{
                        width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                        borderRadius: 6, color: 'var(--sc-text)', fontFamily: "'DM Sans', sans-serif",
                        fontSize: 11, padding: '5px 8px', outline: 'none',
                      }}>
                      {['Bar Cart','Home Bar','Wine Rack','Cellar','Cabinet','Fridge','Garage'].map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>

                  {/* Editable producer field — drives the search link on the card */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                      color: 'var(--sc-muted)', marginBottom: 3 }}>
                      VINEYARD / WINERY / DISTILLERY
                      {(bottle.producer || bottle.brand) && (
                        <span style={{ marginLeft: 6, color: 'var(--sc-teal)', fontSize: 9 }}>
                          🔍 search will use this name
                        </span>
                      )}
                    </div>
                    <input
                      value={bottle.producer || ''}
                      onChange={e => setScanResults(r => r.map((b, bi) => bi === i ? { ...b, producer: e.target.value } : b))}
                      placeholder="e.g. St. Julian Winery"
                      style={{
                        width: '100%', background: 'var(--sc-card)', border: '1px solid var(--sc-border)',
                        borderRadius: 6, color: 'var(--sc-text)',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 12, padding: '6px 8px', outline: 'none', boxSizing: 'border-box',
                      }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Commit bar */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setScanStage('upload'); setScanResults(null) }}
            style={{
              flex: 1, padding: '10px', borderRadius: 9,
              border: '1px solid var(--sc-border)', background: 'transparent',
              color: 'var(--sc-muted)', cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600,
            }}>
            ↺ Rescan
          </button>
          <button onClick={onCommit} disabled={selectedCount === 0}
            style={{
              flex: 2, padding: '10px', borderRadius: 9, border: 'none',
              background: selectedCount > 0 ? 'var(--sc-teal)' : 'var(--sc-border)',
              color: selectedCount > 0 ? '#0c0e14' : 'var(--sc-muted)',
              cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
              opacity: selectedCount > 0 ? 1 : 0.5,
            }}>
            ✓ Add {selectedCount} Bottle{selectedCount !== 1 ? 's' : ''} to Cellar
          </button>
        </div>
      </div>
    )
  }

  // -- DONE STAGE -------------------------------------------------------------
  return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🥂</div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24,
        color: 'var(--sc-teal)', marginBottom: 8 }}>Added to Cellar!</div>
      <button onClick={onClose} style={{
        marginTop: 16, padding: '10px 28px', borderRadius: 9, border: 'none',
        background: 'var(--sc-burgundy)', color: '#fff', cursor: 'pointer',
        fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700,
      }}>Done</button>
    </div>
  )
}
