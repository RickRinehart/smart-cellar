// Smart Cellar — Supabase Client
// Shared Supabase project as Smart Kitchen (same project, separate tables via RLS)
// RG Digital Labs, LLC · June 2026

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase  = createClient(SUPABASE_URL, SUPABASE_ANON)

// -- localStorage key prefix: sc_ (Smart Cellar) ---------------------------
// Smart Kitchen uses sk_ — must not collide in shared browser storage

export const SC_KEYS = {
  darkMode:       'sc_darkMode',
  seniorMode:     'sc_seniorMode',
  cellar:         'sc_cellar',          // bottle inventory array
  pourLog:        'sc_pourLog',         // pour history
  cocktailFavs:   'sc_cocktailFavs',    // saved cocktail recipes
  diyGuides:      'sc_diyGuides',       // craft ingredient progress
  unitPref:       'sc_unitPref',        // 'oz' | 'ml'
  bartesianPods:  'sc_bartesianPods',   // Bartesian pod inventory
  cloudSavedAt:   'sc_cloudSavedAt',
  guestViewer:    'sc_guest_viewer',
  shoppingList:   'sc_shoppingList',   // advisor buy list
}

// -- User profile ---------------------------------------------------------------
export async function getUserProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, tier, trial_ends_at, subscription_status, trial_touchpoints')
    .eq('id', userId)
    .single()
  return data
}

// -- Trial helpers --------------------------------------------------------------
export function trialDaysRemaining(trialEndsAt) {
  if (!trialEndsAt) return 0
  const diff = new Date(trialEndsAt) - new Date()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export async function setTrialStartDate(userId) {
  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 30)
  await supabase
    .from('profiles')
    .update({ trial_ends_at: trialEnd.toISOString(), tier: 'free' })
    .eq('id', userId)
}

// -- Touchpoints ----------------------------------------------------------------
export async function markTouchpoint(userId, key) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('trial_touchpoints')
    .eq('id', userId)
    .single()
  const existing = profile?.trial_touchpoints || {}
  await supabase
    .from('profiles')
    .update({ trial_touchpoints: { ...existing, [key]: new Date().toISOString() } })
    .eq('id', userId)
}

// -- Cloud save/load (SC cellar data stored in sc_cloud_data column) ------------
export async function loadCloudData(userId) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('sc_cloud_data')
      .eq('id', userId)
      .single()

    if (data?.sc_cloud_data) {
      const parsed = typeof data.sc_cloud_data === 'string'
        ? JSON.parse(data.sc_cloud_data)
        : data.sc_cloud_data

      // Restore to localStorage under sc_ keys
      if (parsed.cellar)        localStorage.setItem(SC_KEYS.cellar,        JSON.stringify(parsed.cellar))
      if (parsed.pourLog)       localStorage.setItem(SC_KEYS.pourLog,       JSON.stringify(parsed.pourLog))
      if (parsed.cocktailFavs)  localStorage.setItem(SC_KEYS.cocktailFavs,  JSON.stringify(parsed.cocktailFavs))
      if (parsed.bartesianPods) localStorage.setItem(SC_KEYS.bartesianPods, JSON.stringify(parsed.bartesianPods))
      if (parsed.unitPref)      localStorage.setItem(SC_KEYS.unitPref,      parsed.unitPref)
      if (parsed.shoppingList)  localStorage.setItem(SC_KEYS.shoppingList,  JSON.stringify(parsed.shoppingList))
      return true
    }
  } catch (e) { console.warn('SC loadCloudData:', e) }
  return false
}

export async function saveCloudData(userId) {
  try {
    const payload = {
      cellar:        JSON.parse(localStorage.getItem(SC_KEYS.cellar)        || '[]'),
      pourLog:       JSON.parse(localStorage.getItem(SC_KEYS.pourLog)       || '[]'),
      cocktailFavs:  JSON.parse(localStorage.getItem(SC_KEYS.cocktailFavs)  || '[]'),
      bartesianPods: JSON.parse(localStorage.getItem(SC_KEYS.bartesianPods) || '[]'),
      unitPref:      localStorage.getItem(SC_KEYS.unitPref) || 'oz',
      shoppingList:  JSON.parse(localStorage.getItem(SC_KEYS.shoppingList) || '[]'),
      savedAt:       new Date().toISOString(),
    }
    await supabase
      .from('profiles')
      .update({ sc_cloud_data: JSON.stringify(payload) })
      .eq('id', userId)
    localStorage.setItem(SC_KEYS.cloudSavedAt, new Date().toISOString())
  } catch (e) { console.warn('SC saveCloudData:', e) }
}
