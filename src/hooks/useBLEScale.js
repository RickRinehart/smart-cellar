// Smart Cellar — useBLEScale hook
// Encapsulates Etekcity BLE scale logic extracted from Smart Kitchen App.jsx
// Adapted for Pour & Track: tare → pour → read flow
// RG Digital Labs, LLC · June 2026

import { useState, useRef, useCallback } from 'react'

// -- Confirmed UUIDs (Etekcity ENS-L221S-SUS, nRF Connect, June 2026) ----------
const SCALE_SVC        = '0000fff0-0000-1000-8000-00805f9b34fb'
const SCALE_CHR_NOTIFY = '0000fff1-0000-1000-8000-00805f9b34fb'
const SCALE_CHR_WRITE  = '0000fff2-0000-1000-8000-00805f9b34fb'

// -- Tare payload (confirmed in Smart Kitchen; alt: 0x02, 0x54) -----------------
const TARE_BYTES = new Uint8Array([0x10])

/**
 * Decode a 17-byte BLE notify packet from the Etekcity scale.
 * Confirmed format: bytes[11]|(bytes[12]<<8) little-endian, bytes[14] unit.
 * Calibrated June 7 2026 against 544g Yeti.
 */
function decodeScalePacket(value) {
  const bytes = new Uint8Array(value.buffer)
  const rawHex = Array.from(bytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')

  if (bytes.length < 15) return null

  const raw      = bytes[11] | (bytes[12] << 8)
  const unitByte = bytes[14]

  let displayVal, unit, grams

  if (unitByte === 0x00) {
    // lb: raw/1000 — was previously swapped with oz below, causing lb-mode weights to be
    // misreported (e.g. a true 2.8lb pour showing as 4.48lb). Same bug found and fixed in
    // Smart Kitchen's copy of this decoder (source of the "extracted from" comment above).
    displayVal = raw / 1000; unit = 'lb';    grams = displayVal * 453.592
  } else if (unitByte === 0x01) {
    displayVal = raw / 100;  unit = 'oz';    grams = displayVal * 28.3495
  } else if (unitByte === 0x03) {
    displayVal = raw / 10;   unit = 'ml';    grams = displayVal   // 1ml≈1g water
  } else if (unitByte === 0x04) {
    displayVal = raw / 100;  unit = 'fl.oz'; grams = displayVal * 29.5735
  } else {
    // 0x02 = grams (default / confirmed)
    displayVal = raw / 10;   unit = 'g';     grams = displayVal
  }

  if (grams < 0 || grams > 30000) return null

  return { displayVal, unit, grams, rawHex }
}

/**
 * Convert grams to ml using density appropriate for liquid type.
 * For consumer display — not over-engineered per spec.
 */
export function gramsToMl(grams, liquidType = 'spirits') {
  const densities = {
    wine:    0.990,  // 0.985–0.995 range; midpoint
    beer:    1.005,
    spirits: 0.800,  // 0.789–0.816 range; midpoint
    water:   1.000,
  }
  const density = densities[liquidType] ?? 1.0
  return grams / density
}

/**
 * Convert ml to standard pour sizes for display context.
 */
export function mlToOz(ml) { return ml / 29.5735 }
export function ozToMl(oz) { return oz * 29.5735 }

export function useBLEScale() {
  const [device,      setDevice]      = useState(null)
  const [connecting,  setConnecting]  = useState(false)
  const [error,       setError]       = useState('')
  const [weight,      setWeight]      = useState(null)  // display value
  const [weightGrams, setWeightGrams] = useState(0)
  const [unit,        setUnit]        = useState('oz')
  const [rawBytes,    setRawBytes]    = useState('')

  // Stable weight for pour (debounced 300ms)
  const [stableWeight, setStableWeight] = useState(null)
  const debounceRef = useRef(null)
  const writeChrRef = useRef(null)

  const isConnected    = Boolean(device?.gatt?.connected)
  const browserOK      = typeof navigator !== 'undefined' && Boolean(navigator.bluetooth)

  // -- Handle incoming BLE packet -----------------------------------------------
  const handleNotification = useCallback((e) => {
    const decoded = decodeScalePacket(e.target.value)
    if (!decoded) return

    setRawBytes(decoded.rawHex)
    setWeight(decoded.displayVal)
    setUnit(decoded.unit)
    setWeightGrams(decoded.grams)

    // Debounce for stable pour reading (300ms per spec)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setStableWeight(decoded.displayVal)
    }, 300)
  }, [])

  // -- Connect ------------------------------------------------------------------
  const connect = useCallback(async () => {
    if (!browserOK) { setError('Web Bluetooth requires Chrome or Edge on Android, Windows, or Mac.'); return }
    setConnecting(true)
    setError('')
    try {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [
          { name: 'Etekcity Nutrition Scale' },
          { namePrefix: 'Etekcity' },
          { namePrefix: 'ETC' },
        ],
        optionalServices: [SCALE_SVC, SCALE_CHR_NOTIFY, SCALE_CHR_WRITE],
      })

      setDevice(dev)
      dev.addEventListener('gattserverdisconnected', () => {
        setDevice(null)
        setWeight(null)
        setStableWeight(null)
        writeChrRef.current = null
        setError('Scale disconnected.')
      })

      const server   = await dev.gatt.connect()
      const svc      = await server.getPrimaryService(SCALE_SVC)
      const notifyChr = await svc.getCharacteristic(SCALE_CHR_NOTIFY)
      await notifyChr.startNotifications()
      notifyChr.addEventListener('characteristicvaluechanged', handleNotification)

      try {
        const writeChr = await svc.getCharacteristic(SCALE_CHR_WRITE)
        writeChrRef.current = writeChr
        dev._writeChr = writeChr  // also attach for compat with SK pattern
      } catch (e) {
        console.log('Write chr not available:', e.message)
      }
    } catch (err) {
      if (err.name === 'NotFoundError') setError('No scale found. Make sure the Etekcity scale is on and nearby.')
      else setError('Could not connect: ' + err.message)
    }
    setConnecting(false)
  }, [browserOK, handleNotification])

  // -- Disconnect ---------------------------------------------------------------
  const disconnect = useCallback(() => {
    if (device?.gatt?.connected) device.gatt.disconnect()
    setDevice(null)
    setWeight(null)
    setWeightGrams(0)
    setStableWeight(null)
    setError('')
    writeChrRef.current = null
  }, [device])

  // -- Tare / Zero --------------------------------------------------------------
  const tare = useCallback(async () => {
    const chr = writeChrRef.current || device?._writeChr
    if (chr) {
      try {
        await chr.writeValueWithoutResponse(TARE_BYTES)
      } catch (e) {
        // Try fallback bytes if 0x10 fails (firmware variation)
        try { await chr.writeValueWithoutResponse(new Uint8Array([0x02])) } catch {}
      }
    }
    setWeight(0)
    setWeightGrams(0)
    setStableWeight(0)
  }, [device])

  return {
    // Connection
    isConnected,
    browserOK,
    connecting,
    error,
    connect,
    disconnect,

    // Live readings
    weight,        // current display value in active unit
    weightGrams,   // always grams for calculations
    unit,          // 'oz' | 'g' | 'lb' | 'ml' | 'fl.oz'
    rawBytes,

    // Stable debounced reading (300ms)
    stableWeight,

    // Pour control
    tare,
  }
}
