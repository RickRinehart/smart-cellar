# 🍷 Smart Cellar

**AI-powered bar & bottle inventory with Smart Pour, cocktail discovery, and DIY craft ingredients.**

RG Digital Labs, LLC · Veteran-Owned · Grand Rapids, MI · June 2026

---

## Overview

Smart Cellar is the second app in the RG Digital Labs product flywheel:
**Smart Kitchen → Smart Cellar → Sip & Go**

It shares the same Supabase project, Stripe account, and Anthropic API as Smart Kitchen, with isolated Vercel deployment and separate `sc_` localStorage namespace.

---

## Tech Stack

| Layer         | Technology                                      |
|---------------|-------------------------------------------------|
| Frontend      | React 19 / Vite 8 / PWA                         |
| Auth + DB     | Supabase (shared project: wnlqvmedocpgjawmwivd) |
| Payments      | Stripe (shared live account)                    |
| AI            | Anthropic claude-sonnet-4-5 (smart-cellar key)  |
| Email         | Resend (thesmartkitchenapp workspace)           |
| Hosting       | Vercel (Pro — same account as Smart Kitchen)    |
| BLE Scale     | Web Bluetooth — Etekcity ENS-L221S-SUS          |

---

## Local Development

```bash
# Clone
git clone https://github.com/RickRinehart/smart-cellar.git
cd smart-cellar

# Install
npm install

# Configure environment
cp .env.example .env.local
# Fill in values from .env.example

# Dev server (runs on port 5174 — SK runs on 5173)
npm run dev
```

---

## Environment Variables

See `.env.example`. All values must be set in Vercel dashboard for production.

**Critical:** The Anthropic key for Smart Cellar is the dedicated `smart-cellar` key from the Anthropic console — NOT the Smart Kitchen key.

---

## Supabase Setup

Smart Cellar uses the **same Supabase project** as Smart Kitchen but needs two additions:

### 1. Add `sc_cloud_data` column to `profiles` table
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sc_cloud_data jsonb;
```

### 2. RLS — ensure existing policies allow the same user to read/write their own row
(Already in place from Smart Kitchen setup — no additional policies needed.)

---

## Stripe Setup

Create four new prices in the existing Stripe account (Recurring):

| Product          | Price ID to set in `api/create-checkout-session.js` |
|------------------|------------------------------------------------------|
| Cellar Solo Mo   | `cellar_solo_monthly` → your new Stripe price ID     |
| Cellar Solo Ann  | `cellar_solo_annual`                                 |
| Cellar+ Monthly  | `cellar_family_monthly`                              |
| Cellar+ Annual   | `cellar_family_annual`                               |

Add the Stripe webhook endpoint in the Stripe dashboard:
- **URL:** `https://your-vercel-domain.vercel.app/api/stripe-webhook`
- **Events:** `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`

---

## BLE Scale — Etekcity ENS-L221S-SUS

Scale integration is implemented in `src/hooks/useBLEScale.js`.

All packet format details are in `SmartCellar_ScaleIntegration_Spec_v1.docx` (repo root).

Key constants (confirmed June 7 2026):
- Service: `0xFFF0`
- Notify: `0xFFF1` (weight packets, 17 bytes)
- Write: `0xFFF2` (tare command: `0x10`)
- Weight bytes: `[11] | ([12] << 8)` little-endian
- Unit byte: `[14]` → `0x02=g, 0x00=oz, 0x01=lb`

**Browser support:** Chrome and Edge on Android, Windows, macOS only.
iOS Safari does not support Web Bluetooth — show fallback message.

---

## Smart Kitchen Cross-Promotion

When Smart Kitchen detects an alcohol item, it offers a 30-day Smart Cellar trial with a link:
```
https://smart-cellar.vercel.app?from=smart-kitchen
```

Smart Cellar detects this parameter and shows a cross-promo banner with a link back to Smart Kitchen.

---

## Deployment (Vercel)

```bash
# Build
npm run build

# Deploy via Vercel CLI
npx vercel --prod

# Or connect GitHub repo in Vercel dashboard (recommended)
# Set all env vars in Vercel → Project → Settings → Environment Variables
```

**Pre-deploy checklist:**
- [ ] Vercel Pro active on RG Digital Labs account
- [ ] Custom SMTP configured in Supabase (use Resend thesmartkitchenapp workspace)
- [ ] `sc_cloud_data` column added to Supabase `profiles` table
- [ ] Stripe prices created and Price IDs updated in `api/create-checkout-session.js`
- [ ] Stripe webhook endpoint registered
- [ ] All environment variables set in Vercel dashboard
- [ ] SmartCellarApp.com domain purchased and pointed to Vercel

---

## localStorage Namespace

All Smart Cellar keys use `sc_` prefix to avoid collisions with Smart Kitchen (`sk_` prefix):

| Key                  | Value                        |
|----------------------|------------------------------|
| `sc_cellar`          | Bottle inventory array       |
| `sc_pourLog`         | Pour history                 |
| `sc_cocktailFavs`    | Saved cocktail recipes       |
| `sc_bartesianPods`   | Bartesian pod inventory      |
| `sc_unitPref`        | `'oz'` or `'ml'`            |
| `sc_darkMode`        | `'0'` = light, `'1'` = dark  |
| `sc_cloudSavedAt`    | ISO timestamp of last save   |

---

## Architecture Notes

- Single-file component approach (mirrors Smart Kitchen `App.jsx`)
- `src/hooks/useBLEScale.js` — extracted BLE logic, fully reusable
- `src/supabaseClient.js` — shared Supabase client with `SC_KEYS` namespace
- `api/` — Vercel serverless functions (Stripe, email)
- No external state management — useState + localStorage (SK pattern)

---

*RG Digital Labs, LLC · Confidential — Internal Use Only*
