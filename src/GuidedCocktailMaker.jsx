// Smart Cellar — GuidedCocktailMaker.jsx
// Step-by-step guided cocktail making with BLE scale integration
// Visual glass fill progress, ingredient-by-ingredient flow
// RG Digital Labs, LLC · June 2026

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useBLEScale, gramsToMl, mlToOz, ozToMl } from './hooks/useBLEScale'

// -- Design tokens (mirrors App.jsx C object) -----------------------------------
const C = {
  bg:        'var(--sc-bg)',
  surface:   'var(--sc-surface)',
  card:      'var(--sc-card)',
  border:    'var(--sc-border)',
  burgundy:  'var(--sc-burgundy)',
  gold:      'var(--sc-gold)',
  teal:      'var(--sc-teal)',
  green:     'var(--sc-green)',
  red:       'var(--sc-red)',
  text:      'var(--sc-text)',
  muted:     'var(--sc-muted)',
}
const FD = "'Cormorant Garamond', serif"
const FB = "'DM Sans', sans-serif"
const FM = "'JetBrains Mono', monospace"

// -- Parse an amount string like "1.5 oz", "45 ml", "2 dashes" to grams --------
function parseAmountToGrams(amountStr) {
  if (!amountStr) return null
  const s = amountStr.toLowerCase().trim()

  // dashes / drops / splashes — small amounts, no scale needed
  if (s.includes('dash') || s.includes('drop') || s.includes('splash')
    || s.includes('pinch') || s.includes('barspoon') || s.includes('garnish')
    || s.includes('twist') || s.includes('slice') || s.includes('wedge')
    || s.includes('sprig') || s.includes('leaf')) return null

  const num = parseFloat(s)
  if (isNaN(num)) return null

  if (s.includes('ml'))   return num              // 1ml ≈ 1g water/spirits (close enough)
  if (s.includes('oz'))   return num * 29.5735    // oz → ml → grams
  if (s.includes('cl'))   return num * 10
  if (s.includes('tsp'))  return num * 5
  if (s.includes('tbsp')) return num * 15
  if (s.includes('cup'))  return num * 237
  if (s.includes('g') || s.includes('gram')) return num

  // bare number — assume oz if < 10, ml if >= 10
  if (num < 10) return num * 29.5735
  return num
}

// -- Ingredient step card -------------------------------------------------------
function IngredientStep({
  ingredient, stepIndex, totalSteps, isActive, isDone, isSkipped,
  scale, unitPref, onPoured, onSkip, onTare,
}) {
  const targetGrams  = parseAmountToGrams(ingredient.amount)
  const hasScale     = targetGrams !== null
  const pouredGrams  = scale.weightGrams
  const pouredOz     = mlToOz(pouredGrams)
  const pouredMl     = pouredGrams
  const targetOz     = targetGrams ? mlToOz(targetGrams) : null
  const fillPct      = targetGrams ? Math.min(100, (pouredGrams / targetGrams) * 100) : 0
  const onTarget     = fillPct >= 95 && fillPct <= 115
  const overPoured   = fillPct > 115

  const fillColor    = overPoured ? C.red
                     : onTarget   ? C.teal
                     : fillPct > 70 ? C.gold
                     : C.burgundy

  if (!isActive && !isDone) {
    // Future step — dimmed
    return (
      <div style={{
        background: C.surface, border: '1px solid ' + C.border,
        borderRadius: 12, padding: '12px 16px', opacity: 0.45,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontFamily: FM, fontSize: 11, color: C.muted,
          background: C.card, borderRadius: '50%', width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {stepIndex + 1}
        </div>
        <div>
          <div style={{ fontFamily: FD, fontSize: 16, color: C.text }}>{ingredient.item}</div>
          <div style={{ fontFamily: FM, fontSize: 11, color: C.muted }}>{ingredient.amount}</div>
        </div>
      </div>
    )
  }

  if (isDone || isSkipped) {
    return (
      <div style={{
        background: isSkipped ? C.surface : C.teal + '18',
        border: '1px solid ' + (isSkipped ? C.border : C.teal + '55'),
        borderRadius: 12, padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontSize: 20, flexShrink: 0 }}>
          {isSkipped ? '⏭' : '✓'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FD, fontSize: 16, color: isSkipped ? C.muted : C.teal,
            textDecoration: isSkipped ? 'line-through' : 'none' }}>
            {ingredient.item}
          </div>
          <div style={{ fontFamily: FM, fontSize: 11, color: C.muted }}>{ingredient.amount}</div>
        </div>
        {isDone && !isSkipped && (
          <div style={{ fontFamily: FM, fontSize: 11, color: C.teal, fontWeight: 700 }}>
            {unitPref === 'oz' ? pouredOz.toFixed(2) + ' oz' : pouredMl.toFixed(0) + ' ml'}
          </div>
        )}
      </div>
    )
  }

  // Active step
  return (
    <div style={{
      background: C.card,
      border: '2px solid ' + C.burgundy,
      borderRadius: 14, padding: 18,
    }}>
      {/* Step header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ fontFamily: FM, fontSize: 11, color: '#fff', fontWeight: 700,
          background: C.burgundy, borderRadius: '50%', width: 30, height: 30,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {stepIndex + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FD, fontSize: 22, color: C.text, fontWeight: 700 }}>
            {ingredient.item}
          </div>
          <div style={{ fontFamily: FM, fontSize: 12, color: C.gold, fontWeight: 700 }}>
            {ingredient.amount}
          </div>
        </div>
        <div style={{ fontFamily: FM, fontSize: 10, color: C.muted }}>
          {stepIndex + 1} / {totalSteps}
        </div>
      </div>

      {/* Scale section */}
      {hasScale && scale.isConnected ? (
        <div>
          {/* Live reading + fill bar */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
            {/* Numeric display */}
            <div style={{ textAlign: 'center', minWidth: 90 }}>
              <div style={{ fontFamily: FD, fontSize: 42, color: fillColor,
                lineHeight: 1, fontWeight: 700, transition: 'color 0.3s' }}>
                {unitPref === 'oz' ? pouredOz.toFixed(2) : pouredMl.toFixed(0)}
              </div>
              <div style={{ fontFamily: FM, fontSize: 12, color: C.muted }}>{unitPref}</div>
              {targetOz && (
                <div style={{ fontFamily: FM, fontSize: 10, color: C.muted, marginTop: 2 }}>
                  of {unitPref === 'oz' ? targetOz.toFixed(2) + ' oz' : targetGrams.toFixed(0) + ' ml'}
                </div>
              )}
            </div>

            {/* Vertical fill bar */}
            <div style={{ flex: 1 }}>
              {/* Fill bar background */}
              <div style={{ height: 12, background: C.border, borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{
                  height: '100%',
                  width: Math.min(100, fillPct) + '%',
                  background: fillColor,
                  borderRadius: 6,
                  transition: 'width 0.2s, background 0.3s',
                }} />
              </div>
              {/* Target markers */}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: FM, fontSize: 9, color: C.muted }}>0</span>
                <span style={{ fontFamily: FM, fontSize: 9,
                  color: onTarget ? C.teal : C.muted, fontWeight: onTarget ? 700 : 400 }}>
                  {fillPct.toFixed(0)}%
                </span>
                <span style={{ fontFamily: FM, fontSize: 9, color: C.muted }}>Target</span>
              </div>

              {/* Status message */}
              <div style={{ fontFamily: FM, fontSize: 12, fontWeight: 700,
                color: overPoured ? C.red : onTarget ? C.teal : C.muted,
                marginTop: 6, minHeight: 18 }}>
                {overPoured ? '⚠ Over — tare and try again'
                  : onTarget  ? '✓ Perfect pour!'
                  : fillPct > 0 ? 'Keep pouring…'
                  : 'Start pouring'}
              </div>
            </div>
          </div>

          {/* Tare button */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={onTare}
              style={{ flex: 1, padding: '9px', borderRadius: 9,
                border: '1px solid ' + C.border, background: 'transparent',
                color: C.muted, cursor: 'pointer', fontFamily: FM, fontSize: 12, fontWeight: 600 }}>
              ↺ Tare / Reset
            </button>
            <button onClick={onSkip}
              style={{ padding: '9px 14px', borderRadius: 9,
                border: '1px solid ' + C.border, background: 'transparent',
                color: C.muted, cursor: 'pointer', fontFamily: FM, fontSize: 11 }}>
              Skip ⏭
            </button>
            <button onClick={() => onPoured(pouredGrams)}
              disabled={fillPct < 10}
              style={{ flex: 2, padding: '9px', borderRadius: 9,
                border: 'none', fontFamily: FM, fontSize: 13, fontWeight: 700,
                cursor: fillPct < 10 ? 'not-allowed' : 'pointer',
                background: fillPct < 10 ? C.border : C.teal,
                color: fillPct < 10 ? C.muted : '#0c0e14',
                transition: 'all 0.2s' }}>
              ✓ Added
            </button>
          </div>
        </div>
      ) : hasScale && !scale.isConnected ? (
        // Scale not connected for this measurable ingredient
        <div style={{ background: C.surface, borderRadius: 10, padding: 12,
          fontFamily: FM, fontSize: 11, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
          ⚖ Connect scale for guided pour, or add by eye and mark done.
        </div>
      ) : (
        // No scale measurement needed (dashes, garnish etc)
        <div style={{ background: C.gold + '18', border: '1px solid ' + C.gold + '44',
          borderRadius: 10, padding: 12, fontFamily: FM, fontSize: 12,
          color: C.gold, lineHeight: 1.6, marginBottom: 12 }}>
          Add {ingredient.amount} {ingredient.item} — no scale needed for this step.
        </div>
      )}

      {/* Done button for non-scale steps */}
      {(!hasScale || !scale.isConnected) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onSkip}
            style={{ flex: 1, padding: '9px', borderRadius: 9,
              border: '1px solid ' + C.border, background: 'transparent',
              color: C.muted, cursor: 'pointer', fontFamily: FM, fontSize: 11 }}>
            Skip ⏭
          </button>
          <button onClick={() => onPoured(0)}
            style={{ flex: 2, padding: '9px', borderRadius: 9,
              border: 'none', background: C.teal, color: '#0c0e14',
              cursor: 'pointer', fontFamily: FM, fontSize: 13, fontWeight: 700 }}>
            ✓ Added
          </button>
        </div>
      )}
    </div>
  )
}

// -- Glass fill SVG visual -------------------------------------------------------
function GlassFillVisual({ ingredients, completedSteps, currentStep, glassware }) {
  // Calculate total poured vs total recipe
  const measurable = ingredients.filter(i => parseAmountToGrams(i.amount) !== null)
  const totalGrams = measurable.reduce((sum, i) => sum + (parseAmountToGrams(i.amount) || 0), 0)
  const pouredGrams = completedSteps.reduce((sum, s) => sum + (s.grams || 0), 0)
  const fillPct = totalGrams > 0 ? Math.min(95, (pouredGrams / totalGrams) * 100) : 0

  const isWineGlass = glassware?.toLowerCase().includes('wine') || glassware?.toLowerCase().includes('coupe')
  const isShotGlass = glassware?.toLowerCase().includes('shot')

  // Layer colors for each ingredient
  const layerColors = [C.burgundy, C.gold, C.teal, '#5b9cf6', '#fb923c', '#a78bfa']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={70} height={110} viewBox="0 0 70 110">
        {isWineGlass ? (
          <>
            {/* Wine glass */}
            <path d="M18 8 Q8 42 28 72 L35 82 L42 72 Q62 42 52 8 Z"
              fill="none" stroke={'var(--sc-border)'} strokeWidth={2} />
            <line x1={35} y1={82} x2={35} y2={105} stroke={'var(--sc-border)'} strokeWidth={2} />
            <line x1={20} y1={105} x2={50} y2={105} stroke={'var(--sc-border)'} strokeWidth={2} />
            <clipPath id="gcm-wine-clip">
              <path d="M18 8 Q8 42 28 72 L35 82 L42 72 Q62 42 52 8 Z" />
            </clipPath>
            {/* Fill layers */}
            {completedSteps.map((step, i) => {
              if (!step.grams) return null
              const layerPct = totalGrams > 0 ? (step.grams / totalGrams) * 64 : 0
              const prevPct  = completedSteps.slice(0, i).reduce((s, cs) =>
                s + (totalGrams > 0 ? ((cs.grams || 0) / totalGrams) * 64 : 0), 0)
              return (
                <rect key={i}
                  x={16} y={8 + 64 - prevPct - layerPct}
                  width={38} height={layerPct}
                  fill={layerColors[i % layerColors.length]}
                  opacity={0.75}
                  clipPath="url(#gcm-wine-clip)"
                />
              )
            })}
          </>
        ) : isShotGlass ? (
          <>
            {/* Shot glass */}
            <path d="M22 12 L18 88 L52 88 L48 12 Z"
              fill="none" stroke={'var(--sc-border)'} strokeWidth={2} />
            <clipPath id="gcm-shot-clip">
              <path d="M22 12 L18 88 L52 88 L48 12 Z" />
            </clipPath>
            {completedSteps.map((step, i) => {
              if (!step.grams) return null
              const h = totalGrams > 0 ? (step.grams / totalGrams) * 76 : 0
              const prevH = completedSteps.slice(0, i).reduce((s, cs) =>
                s + (totalGrams > 0 ? ((cs.grams || 0) / totalGrams) * 76 : 0), 0)
              return <rect key={i} x={16} y={12 + 76 - prevH - h} width={38} height={h}
                fill={layerColors[i % layerColors.length]} opacity={0.75}
                clipPath="url(#gcm-shot-clip)" />
            })}
          </>
        ) : (
          <>
            {/* Rocks / highball glass (default) */}
            <path d="M16 10 L20 100 L50 100 L54 10 Z"
              fill="none" stroke={'var(--sc-border)'} strokeWidth={2} />
            <clipPath id="gcm-rocks-clip">
              <path d="M16 10 L20 100 L50 100 L54 10 Z" />
            </clipPath>
            {completedSteps.map((step, i) => {
              if (!step.grams) return null
              const h = totalGrams > 0 ? (step.grams / totalGrams) * 90 : 0
              const prevH = completedSteps.slice(0, i).reduce((s, cs) =>
                s + (totalGrams > 0 ? ((cs.grams || 0) / totalGrams) * 90 : 0), 0)
              return <rect key={i} x={18} y={10 + 90 - prevH - h} width={34} height={h}
                fill={layerColors[i % layerColors.length]} opacity={0.75}
                clipPath="url(#gcm-rocks-clip)" />
            })}
          </>
        )}
      </svg>
      <div style={{ fontFamily: FM, fontSize: 10, color: C.muted }}>
        {glassware || 'Glass'} · {fillPct.toFixed(0)}% full
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export default function GuidedCocktailMaker({ cocktail, cellar, unitPref, onClose, onLogPour }) {
  const scale = useBLEScale()

  const ingredients = cocktail.ingredients || []
  const steps       = cocktail.steps       || []

  const [currentIngredient, setCurrentIngredient] = useState(0)
  const [completedSteps, setCompletedSteps]       = useState([]) // {index, grams, skipped}
  const [phase, setPhase]                          = useState('ingredients') // 'ingredients' | 'method' | 'done'
  const [currentMethodStep, setCurrentMethodStep] = useState(0)
  const [timerActive, setTimerActive]              = useState(false)
  const [timerSeconds, setTimerSeconds]            = useState(0)
  const timerRef = useRef(null)

  const allIngredientsDone = completedSteps.length >= ingredients.length

  // -- Timer for method steps ---------------------------------------------------
  useEffect(() => {
    if (timerActive && timerSeconds > 0) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(s => {
          if (s <= 1) { setTimerActive(false); clearInterval(timerRef.current); return 0 }
          return s - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [timerActive])

  function handlePoured(grams) {
    setCompletedSteps(prev => [...prev, { index: currentIngredient, grams, skipped: false }])
    if (currentIngredient < ingredients.length - 1) {
      setCurrentIngredient(i => i + 1)
      scale.tare()
    } else {
      setPhase('method')
    }
  }

  function handleSkip() {
    setCompletedSteps(prev => [...prev, { index: currentIngredient, grams: 0, skipped: true }])
    if (currentIngredient < ingredients.length - 1) {
      setCurrentIngredient(i => i + 1)
    } else {
      setPhase('method')
    }
  }

  function handleMethodNext() {
    if (currentMethodStep < steps.length - 1) {
      setCurrentMethodStep(s => s + 1)
      setTimerActive(false)
      setTimerSeconds(0)
    } else {
      setPhase('done')
      if (onLogPour) onLogPour(cocktail, completedSteps)
    }
  }

  const progressPct = phase === 'done' ? 100
    : phase === 'method' ? 50 + ((currentMethodStep + 1) / Math.max(1, steps.length)) * 50
    : (completedSteps.length / Math.max(1, ingredients.length)) * 50

  return (
    <div style={{ fontFamily: FB }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FD, fontSize: 24, color: C.burgundy, fontWeight: 700,
          lineHeight: 1.2, marginBottom: 4 }}>
          {cocktail.name}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {cocktail.glassware && (
            <span style={{ fontFamily: FM, fontSize: 10, color: C.muted,
              background: C.surface, border: '1px solid ' + C.border,
              borderRadius: 6, padding: '2px 8px' }}>
              🥃 {cocktail.glassware}
            </span>
          )}
          {cocktail.difficulty && (
            <span style={{ fontFamily: FM, fontSize: 10, color: C.gold,
              background: C.gold + '18', border: '1px solid ' + C.gold + '44',
              borderRadius: 6, padding: '2px 8px' }}>
              {cocktail.difficulty}
            </span>
          )}
        </div>

        {/* Overall progress bar */}
        <div style={{ height: 6, background: C.border, borderRadius: 3, marginBottom: 4 }}>
          <div style={{ height: '100%', width: progressPct + '%', borderRadius: 3,
            background: phase === 'done' ? C.teal : C.burgundy,
            transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ fontFamily: FM, fontSize: 10, color: C.muted }}>
          {phase === 'ingredients' ? `Ingredients · ${completedSteps.length} of ${ingredients.length}`
           : phase === 'method' ? `Method · step ${currentMethodStep + 1} of ${steps.length}`
           : '🥂 Ready to serve!'}
        </div>
      </div>

      {/* ── PHASE: INGREDIENTS ── */}
      {phase === 'ingredients' && (
        <div style={{ display: 'flex', gap: 14 }}>

          {/* Left: glass visual */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <GlassFillVisual
              ingredients={ingredients}
              completedSteps={completedSteps}
              currentStep={currentIngredient}
              glassware={cocktail.glassware}
            />

            {/* Scale connection */}
            {!scale.isConnected ? (
              <button onClick={scale.connect} disabled={scale.connecting || !scale.browserOK}
                style={{ padding: '6px 10px', borderRadius: 8, border: 'none',
                  background: scale.browserOK ? C.teal : C.border,
                  color: scale.browserOK ? '#0c0e14' : C.muted,
                  fontFamily: FM, fontSize: 10, fontWeight: 700,
                  cursor: scale.browserOK ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                {scale.connecting ? '⟳ Searching…' : '⚖ Connect Scale'}
              </button>
            ) : (
              <div style={{ fontFamily: FM, fontSize: 9, color: C.teal,
                fontWeight: 700, textAlign: 'center' }}>
                ⚖ Scale Live
              </div>
            )}
          </div>

          {/* Right: ingredient steps */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ingredients.map((ing, i) => (
              <IngredientStep
                key={i}
                ingredient={ing}
                stepIndex={i}
                totalSteps={ingredients.length}
                isActive={i === currentIngredient}
                isDone={completedSteps.some(s => s.index === i && !s.skipped)}
                isSkipped={completedSteps.some(s => s.index === i && s.skipped)}
                scale={i === currentIngredient ? scale : { isConnected: false, weightGrams: 0 }}
                unitPref={unitPref}
                onPoured={handlePoured}
                onSkip={handleSkip}
                onTare={scale.tare}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── PHASE: METHOD ── */}
      {phase === 'method' && (
        <div>
          {/* Ingredient summary */}
          <div style={{ background: C.surface, border: '1px solid ' + C.border,
            borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ fontFamily: FM, fontSize: 10, color: C.teal,
              fontWeight: 700, marginBottom: 6 }}>INGREDIENTS ADDED</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {completedSteps.map((s, i) => (
                <span key={i} style={{ fontFamily: FM, fontSize: 10,
                  color: s.skipped ? C.muted : C.text,
                  background: C.card, borderRadius: 6, padding: '2px 8px',
                  border: '1px solid ' + C.border,
                  textDecoration: s.skipped ? 'line-through' : 'none' }}>
                  {ingredients[s.index]?.item}
                </span>
              ))}
            </div>
          </div>

          {/* Current method step */}
          <div style={{ background: C.card, border: '2px solid ' + C.burgundy,
            borderRadius: 14, padding: 20, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontFamily: FM, fontSize: 12, color: '#fff', fontWeight: 700,
                background: C.burgundy, borderRadius: '50%', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {currentMethodStep + 1}
              </div>
              <div style={{ fontFamily: FM, fontSize: 10, color: C.muted }}>
                Step {currentMethodStep + 1} of {steps.length}
              </div>
            </div>
            <div style={{ fontFamily: FB, fontSize: 16, color: C.text, lineHeight: 1.6 }}>
              {steps[currentMethodStep]}
            </div>
          </div>

          {/* Remaining steps preview */}
          {steps.slice(currentMethodStep + 1).map((step, i) => (
            <div key={i} style={{ background: C.surface, border: '1px solid ' + C.border,
              borderRadius: 10, padding: '10px 14px', marginBottom: 8, opacity: 0.45,
              display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontFamily: FM, fontSize: 10, color: C.muted,
                background: C.card, borderRadius: '50%', width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {currentMethodStep + i + 2}
              </span>
              <span style={{ fontFamily: FB, fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                {step}
              </span>
            </div>
          ))}

          <button onClick={handleMethodNext}
            style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none',
              background: currentMethodStep < steps.length - 1 ? C.burgundy : C.teal,
              color: currentMethodStep < steps.length - 1 ? '#fff' : '#0c0e14',
              fontFamily: FM, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              marginTop: 8 }}>
            {currentMethodStep < steps.length - 1 ? 'Next Step →' : '🥂 Cocktail Ready!'}
          </button>
        </div>
      )}

      {/* ── PHASE: DONE ── */}
      {phase === 'done' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 52, marginBottom: 12 }}>🥂</div>
          <div style={{ fontFamily: FD, fontSize: 28, color: C.text, marginBottom: 6 }}>
            {cocktail.name}
          </div>
          <div style={{ fontFamily: FM, fontSize: 12, color: C.muted,
            marginBottom: 20, lineHeight: 1.6 }}>
            {cocktail.tasting_notes || 'Enjoy your cocktail!'}
          </div>
          {cocktail.garnish && (
            <div style={{ fontFamily: FM, fontSize: 12, color: C.gold,
              background: C.gold + '18', borderRadius: 10, padding: '8px 16px',
              display: 'inline-block', marginBottom: 20 }}>
              🍋 Garnish with {cocktail.garnish}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={onClose}
              style={{ padding: '12px 28px', borderRadius: 10, border: 'none',
                background: C.teal, color: '#0c0e14', fontFamily: FM,
                fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Done 🥂
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
