declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: Record<string, unknown>
      ) => string | number
      reset: (widgetId?: string | number) => void
      remove?: (widgetId?: string | number) => void
    }
    TURNSTILE_SITE_KEY?: string
    __turnstileReady?: boolean
    onTurnstileLoad?: () => void
  }
}

let TS_WIDGET_ID: string | number | null = null

export function getTurnstileSiteKey(): string {
  const meta = document.querySelector('meta[name="turnstile-site-key"]')
  const metaKey = (meta?.getAttribute('content') || '').trim()
  if (metaKey) return metaKey

  const bodyKey = (document.body?.dataset?.turnstileSitekey || '').trim()
  if (bodyKey) return bodyKey

  const globalKey = (window.TURNSTILE_SITE_KEY || '').trim()
  if (globalKey) return globalKey

  return ''
}

export function getTurnstileToken(): string {
  const el = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null
  return (el?.value || '').trim()
}

export function hasVisibleCaptcha(): boolean {
  const wrap = document.getElementById('turnstile-wrap')
  if (!wrap) return false
  return wrap.style.display !== 'none'
}

export function ensureCaptchaBox(): HTMLDivElement {
  let box = document.getElementById('turnstile-wrap') as HTMLDivElement | null
  if (box) return box

  const form =
    (document.getElementById('login-form') as HTMLFormElement | null) ||
    document.querySelector('form')

  box = document.createElement('div')
  box.id = 'turnstile-wrap'
  box.style.display = 'none'
  box.style.marginTop = '12px'
  box.style.marginBottom = '8px'
  box.style.justifyContent = 'center'
  box.style.alignItems = 'center'
  box.style.width = '100%'

  const submitBtn = form?.querySelector('button[type="submit"]')
  if (form && submitBtn?.parentElement) {
    submitBtn.parentElement.insertBefore(box, submitBtn)
  } else if (form) {
    form.appendChild(box)
  } else {
    document.body.appendChild(box)
  }

  return box
}

export function hideCaptcha() {
  const wrap = document.getElementById('turnstile-wrap') as HTMLDivElement | null
  if (!wrap) return
  wrap.style.display = 'none'
}

export function resetTurnstile() {
  try {
    if (TS_WIDGET_ID != null) {
      window.turnstile?.reset?.(TS_WIDGET_ID)
    } else {
      window.turnstile?.reset?.()
    }
  } catch {
    // noop
  }
}

export async function ensureTurnstileScriptLoaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        resolve()
        return
      }

      const existing = document.querySelector(
        'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]'
      ) as HTMLScriptElement | null

      if (existing) {
        let tries = 0
        const timer = window.setInterval(() => {
          tries += 1

          if (window.turnstile && typeof window.turnstile.render === 'function') {
            window.clearInterval(timer)
            resolve()
            return
          }

          if (tries > 50) {
            window.clearInterval(timer)
            reject(new Error('Turnstile script no expuso window.turnstile a tiempo.'))
          }
        }, 100)

        return
      }

      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true

      script.onload = () => {
        let tries = 0
        const timer = window.setInterval(() => {
          tries += 1

          if (window.turnstile && typeof window.turnstile.render === 'function') {
            window.clearInterval(timer)
            resolve()
            return
          }

          if (tries > 50) {
            window.clearInterval(timer)
            reject(new Error('Turnstile script cargó pero no expuso window.turnstile.'))
          }
        }, 100)
      }

      script.onerror = () => reject(new Error('No se pudo cargar Turnstile.'))
      document.head.appendChild(script)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Error cargando Turnstile.'))
    }
  })
}

export async function showCaptcha(): Promise<void> {
  const siteKey = getTurnstileSiteKey()
  if (!siteKey) {
    throw new Error('Falta configurar el Site Key de Turnstile.')
  }

  const wrap = ensureCaptchaBox()
  wrap.style.display = 'flex'
  wrap.innerHTML = ''

  const slot = document.createElement('div')
  slot.id = 'cf-turnstile-slot'
  wrap.appendChild(slot)

  await ensureTurnstileScriptLoaded()

  TS_WIDGET_ID = window.turnstile?.render(slot, {
    sitekey: siteKey,
    size: 'normal',
    theme: 'auto',
    appearance: 'always',
    callback: () => {
      // el token queda en input[name="cf-turnstile-response"]
    },
    'expired-callback': () => {
      try {
        if (TS_WIDGET_ID != null) {
          window.turnstile?.reset?.(TS_WIDGET_ID)
        }
      } catch {
        // noop
      }
    },
    'error-callback': () => {
      try {
        if (TS_WIDGET_ID != null) {
          window.turnstile?.reset?.(TS_WIDGET_ID)
        }
      } catch {
        // noop
      }
    },
  }) ?? null
}