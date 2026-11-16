import { useEffect, useRef, useState, type FormEvent } from 'react'
import { normalizeCode, validCode } from '../../lib/barcode'

const FORMATS = ['ean_13', 'upc_a', 'upc_e', 'ean_8']

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}
interface NativeDetectorClass {
  new (opts: { formats: string[] }): NativeDetector
  getSupportedFormats(): Promise<string[]>
}

/**
 * Full-screen camera view that reads a product barcode. Uses the browser's
 * own barcode reader where there is one (Chrome on Android), and the ZXing
 * library everywhere else, including every browser on iPhone. A typed code
 * works too.
 */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    let cancelled = false
    let stop = () => {}
    let found = false

    const done = (raw: string) => {
      const code = normalizeCode(raw)
      if (found || cancelled || !validCode(code)) return
      found = true
      stop()
      navigator.vibrate?.(60)
      onCode(code)
    }

    void (async () => {
      const el = video.current
      if (!el) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open the camera here. Type the number under the barcode instead.")
        setStarting(false)
        return
      }
      const constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      }
      try {
        const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
        const supported = Native ? await Native.getSupportedFormats().catch(() => []) : []
        const formats = FORMATS.filter((f) => supported.includes(f))
        if (Native && formats.length) {
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          let timer = 0
          stop = () => {
            window.clearInterval(timer)
            stream.getTracks().forEach((t) => t.stop())
          }
          if (cancelled) return stop()
          el.srcObject = stream
          await el.play()
          setStarting(false)
          const detector = new Native({ formats })
          let busy = false
          timer = window.setInterval(() => {
            if (busy || el.readyState < 2) return
            busy = true
            detector
              .detect(el)
              .then((codes) => codes[0] && done(codes[0].rawValue))
              .catch(() => {})
              .finally(() => {
                busy = false
              })
          }, 150)
        } else {
          // Loaded only when needed: most of the app never scans.
          const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library'),
          ])
          const hints = new Map()
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8,
          ])
          const reader = new BrowserMultiFormatReader(hints)
          const controls = await reader.decodeFromConstraints(constraints, el, (result) => {
            if (result) done(result.getText())
          })
          stop = () => controls.stop()
          if (cancelled) return stop()
          setStarting(false)
        }
      } catch (e) {
        const name = (e as { name?: string }).name
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was turned down. Allow the camera for this site in your browser settings, or type the number under the barcode.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera was found. Type the number under the barcode instead.'
              : "The camera didn't start. Type the number under the barcode instead.",
        )
        setStarting(false)
      }
    })()

    return () => {
      cancelled = true
      stop()
    }
    // onCode is read once per scan; restarting the camera on every render would flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const code = normalizeCode(typed)
    if (!validCode(code)) return setError('A barcode number is 8 to 13 digits.')
    onCode(code)
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan a barcode">
      <div className="scanner-top">
        <strong>Scan a barcode</strong>
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="scanner-view">
        <video ref={video} playsInline muted />
        <div className="scanner-aim" aria-hidden="true" />
        {starting && !error && <p className="scanner-note">Starting the camera…</p>}
      </div>
      {error ? <p className="msg err">{error}</p> : <p className="hint">Hold the barcode inside the box. It reads it on its own.</p>}
      <form className="inline-form" onSubmit={submit}>
        <input
          inputMode="numeric"
          autoComplete="off"
          aria-label="Barcode number"
          placeholder="Or type the barcode number"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="btn" type="submit">
          Look up
        </button>
      </form>
    </div>
  )
}
