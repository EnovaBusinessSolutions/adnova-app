import { getSession } from './session'
import {
  getTurnstileToken,
  hideCaptcha,
  resetTurnstile,
  showCaptcha,
} from './turnstile'
import adrayIcon from './assets/adray-icon.png'

type RegisterResponse = {
  success?: boolean
  ok?: boolean
  message?: string
  error?: string
  confirmUrl?: string
  code?: string
  errorCodes?: string[]
}

export function renderGetStarted() {
  const root = document.querySelector('#login-root') as HTMLDivElement | null
  if (!root) return

  root.innerHTML = `
    <div class="background">
      <div class="background-base"></div>
      <div class="background-grid"></div>
      <div class="background-noise"></div>

      <div class="background-aurora aurora-1"></div>
      <div class="background-aurora aurora-2"></div>
      <div class="background-aurora aurora-3"></div>

      <div class="background-glow glow-top"></div>
      <div class="background-glow glow-left"></div>
      <div class="background-glow glow-right"></div>
      <div class="background-glow glow-bottom"></div>

      <div class="background-orbit orbit-1"></div>
      <div class="background-orbit orbit-2"></div>
      <div class="background-orbit orbit-3"></div>

      <div class="vertical-line"></div>
      <div class="horizontal-line"></div>
    </div>

    <div class="login-container">
      <div class="login-card">
        <div class="login-card-glow" aria-hidden="true"></div>
        <div class="login-card-noise" aria-hidden="true"></div>
        <div class="login-card-aurora" aria-hidden="true"></div>

        <div class="login-topbar login-topbar--minimal">
          <div class="login-brand-icon-wrap" aria-hidden="true">
            <img
              src="${adrayIcon}"
              alt="Adray"
              class="login-brand-icon"
              decoding="async"
            />
          </div>
        </div>

        <h1 class="login-heading">Create free account</h1>

        <form id="getstarted-form" novalidate>
          <div class="input-group">
            <label class="input-label" for="name">Full name</label>
            <input
              id="name"
              class="input"
              type="text"
              placeholder="Your full name"
              autocomplete="name"
            />
          </div>

          <div class="input-group">
            <label class="input-label" for="email">Email</label>
            <input
              id="email"
              class="input"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
            />
          </div>

          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label" for="password">Password</label>
            </div>

            <div class="password-wrap">
              <input
                id="password"
                class="input input-password"
                type="password"
                placeholder="At least 8 characters"
                autocomplete="new-password"
              />

              <button
                id="toggle-password"
                class="toggle-password"
                type="button"
                aria-label="Show or hide password"
                aria-pressed="false"
              >
                <span class="eye-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <div class="input-group">
            <div class="input-label-row">
              <label class="input-label" for="confirm-password">Confirm password</label>
            </div>

            <div class="password-wrap">
              <input
                id="confirm-password"
                class="input input-password"
                type="password"
                placeholder="Repeat your password"
                autocomplete="new-password"
              />

              <button
                id="toggle-confirm-password"
                class="toggle-password"
                type="button"
                aria-label="Show or hide confirm password"
                aria-pressed="false"
              >
                <span class="eye-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <div id="turnstile-wrap"></div>

          <p id="getstarted-message" class="login-message" aria-live="polite"></p>

          <button id="submit-btn" class="btn btn-primary" type="submit">
            Create account
          </button>
        </form>

        <div class="register-wrapper">
          <button id="login-btn" class="btn btn-secondary" type="button">
            Login
          </button>
        </div>

        <div class="divider">
          <span class="divider-text">OR</span>
        </div>

        <div class="social-buttons">
          <button id="google-btn" class="gsi-material-button" style="width:197px;" type="button">
            <div class="gsi-material-button-state"></div>
            <div class="gsi-material-button-content-wrapper">
              <div class="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span class="gsi-material-button-contents">Continue with Google</span>
              <span style="display:none;">Continue with Google</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  `

  bindGetStartedEvents()
  bindSecondaryActions()
  bindPasswordToggle('#password', '#toggle-password')
  bindPasswordToggle('#confirm-password', '#toggle-confirm-password')
  checkExistingSession()
  void mountCaptcha()
}

function showMessage(text: string, isOk = false) {
  const box = document.querySelector('#getstarted-message') as HTMLParagraphElement | null
  if (!box) return

  box.textContent = text
  box.style.display = 'block'
  box.style.color = isOk ? '#f3f0ff' : '#fda4af'
}

function hideMessage() {
  const box = document.querySelector('#getstarted-message') as HTMLParagraphElement | null
  if (!box) return

  box.textContent = ''
  box.style.display = 'none'
}

function setSubmitting(isSubmitting: boolean) {
  const btn = document.querySelector('#submit-btn') as HTMLButtonElement | null
  const googleBtn = document.querySelector('#google-btn') as HTMLButtonElement | null
  const loginBtn = document.querySelector('#login-btn') as HTMLButtonElement | null

  if (btn) {
    btn.disabled = isSubmitting
    btn.textContent = isSubmitting ? 'Creating account...' : 'Create account'
  }

  if (googleBtn) googleBtn.disabled = isSubmitting
  if (loginBtn) loginBtn.disabled = isSubmitting
}

function bindSecondaryActions() {
  const loginBtn = document.querySelector('#login-btn') as HTMLButtonElement | null
  const googleBtn = document.querySelector('#google-btn') as HTMLButtonElement | null

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      window.location.href = '/login'
    })
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      window.location.href = '/auth/google/login'
    })
  }
}

function bindPasswordToggle(inputSelector: string, toggleSelector: string) {
  const input = document.querySelector(inputSelector) as HTMLInputElement | null
  const toggle = document.querySelector(toggleSelector) as HTMLButtonElement | null

  if (!input || !toggle) return

  toggle.addEventListener('click', () => {
    const isHidden = input.type === 'password'
    input.type = isHidden ? 'text' : 'password'
    toggle.setAttribute('aria-pressed', String(isHidden))
    toggle.classList.toggle('is-visible', isHidden)
    input.focus({ preventScroll: true })

    try {
      const len = input.value.length
      input.setSelectionRange(len, len)
    } catch {
      // noop
    }
  })
}

async function mountCaptcha() {
  try {
    await showCaptcha()
    // NO resetear inmediatamente después del render.
    // El reset inmediato crea un race condition que deja el widget en
    // estado inconsistente en navegadores con privacidad estricta
    // (Brave shields, Firefox ETP, uBlock, etc.). El widget ya sale
    // limpio tras showCaptcha(); el reset solo debe dispararse bajo
    // demanda (ej. cuando el token expira o el backend rechaza).
  } catch (error) {
    console.error('[getstarted] captcha error:', error)
    hideCaptcha()
    showMessage(
      'Security verification could not be loaded. ' +
        'If you use Brave, uBlock, or privacy extensions, ' +
        'try disabling shields for this site and reload.',
    )
  }
}

function bindGetStartedEvents() {
  const form = document.querySelector('#getstarted-form') as HTMLFormElement | null
  if (!form) return

  let inFlight = false

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (inFlight) return

    hideMessage()

    const name =
      (document.querySelector('#name') as HTMLInputElement | null)?.value.trim() || ''

    const email =
      (document.querySelector('#email') as HTMLInputElement | null)?.value.trim().toLowerCase() || ''

    const password =
      (document.querySelector('#password') as HTMLInputElement | null)?.value ?? ''

    const confirmPassword =
      (document.querySelector('#confirm-password') as HTMLInputElement | null)?.value ?? ''

    if (!name || !email || !password || !confirmPassword) {
      showMessage('Complete all fields to continue.')
      return
    }

    if (name.length < 2) {
      showMessage('Enter your full name.')
      return
    }

    if (password.length < 8) {
      showMessage('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      showMessage('Passwords do not match.')
      return
    }

    const turnstileToken = getTurnstileToken()
    if (!turnstileToken) {
      showMessage('Complete the security verification to continue.')
      return
    }

    inFlight = true
    setSubmitting(true)

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          password,
          turnstileToken,
        }),
      })

      const data = (await safeJson(res)) as RegisterResponse
      const success = Boolean(data?.success ?? data?.ok)

      if (res.ok && success) {
        try {
          ;(window as Window & { gtag?: (...args: unknown[]) => void }).gtag?.('event', 'sign_up', {
            method: 'email',
          })
        } catch {
          // noop
        }

        hideCaptcha()
        showMessage(
          data.message || 'Account created successfully. Check your email to verify your account.',
          true,
        )

        const nextUrl =
          data.confirmUrl ||
          `/confirmation.html?email=${encodeURIComponent(email)}`

        window.setTimeout(() => {
          window.location.href = nextUrl
        }, 900)

        return
      }

      const isTurnstileFailure =
        data?.code === 'TURNSTILE_FAILED' ||
        data?.code === 'TURNSTILE_REQUIRED_OR_FAILED' ||
        (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) ||
        res.status === 400

      if (isTurnstileFailure) {
        resetTurnstile()
      }

      showMessage(
        data?.message ||
          data?.error ||
          (res.status === 409
            ? 'This email is already registered.'
            : 'Could not create your account. Please try again.'),
      )
    } catch (error) {
      console.error(error)
      resetTurnstile()
      showMessage('Could not connect to the server.')
    } finally {
      inFlight = false
      setSubmitting(false)
    }
  })
}

async function checkExistingSession() {
  try {
    const session = await getSession()
    if (session && (session.authenticated || session.ok)) {
      window.location.replace('/dashboard/')
    }
  } catch {
    // noop
  }
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return {}
  }
}
