import {
  backendWantsCaptcha,
  getLoginErrorMessage,
  isSuccessPayload,
  postLogin,
} from './auth'
import { getSession, waitForSessionAndRedirect } from './session'
import {
  getTurnstileToken,
  hasVisibleCaptcha,
  hideCaptcha,
  showCaptcha,
} from './turnstile'
import adrayIcon from './assets/adray-icon.png'

export function renderLogin() {
  const root = document.querySelector('#login-root') as HTMLDivElement

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

        <h1 class="login-heading">Login to your account</h1>

        <form id="login-form" novalidate>
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
                placeholder="••••••••"
                autocomplete="current-password"
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

          <div id="turnstile-wrap" style="display:none"></div>

          <p id="login-message" class="login-message" aria-live="polite"></p>

          <button id="submit-btn" class="btn btn-primary" type="submit">Sign in</button>
        </form>

        <div class="register-wrapper">
          <button id="register-btn" class="btn btn-secondary" type="button">
            Create account
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

        <p class="forgot-password">
          Forgot password?
          <a href="/recuperar.html" class="recovery-link">Recover it here</a>
        </p>
      </div>
    </div>
  `

  bindLoginEvents()
  bindSecondaryActions()
  bindPasswordToggle()
  checkExistingSession()
  handleVerifiedNotice()
}

function showMessage(text: string, isOk = false) {
  const box = document.querySelector('#login-message') as HTMLParagraphElement | null
  if (!box) return

  box.textContent = text
  box.style.display = 'block'
  box.style.color = isOk ? '#f3f0ff' : '#fda4af'
}

function hideMessage() {
  const box = document.querySelector('#login-message') as HTMLParagraphElement | null
  if (!box) return

  box.textContent = ''
  box.style.display = 'none'
}

function setSubmitting(isSubmitting: boolean) {
  const btn = document.querySelector('#submit-btn') as HTMLButtonElement | null
  const googleBtn = document.querySelector('#google-btn') as HTMLButtonElement | null
  const registerBtn = document.querySelector('#register-btn') as HTMLButtonElement | null

  if (btn) {
    btn.disabled = isSubmitting
    btn.textContent = isSubmitting ? 'Signing in...' : 'Sign in'
  }

  if (googleBtn) googleBtn.disabled = isSubmitting
  if (registerBtn) registerBtn.disabled = isSubmitting
}

function bindSecondaryActions() {
  const registerBtn = document.querySelector('#register-btn') as HTMLButtonElement | null
  const googleBtn = document.querySelector('#google-btn') as HTMLButtonElement | null

  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      window.location.href = '/getstarted'
    })
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      // Forward any returnTo in the URL so the OAuth connector flow
      // (Claude.ai / ChatGPT / Gemini) resumes after Google sign-in
      // instead of dropping the user on /dashboard/ and losing the handshake.
      const params = new URLSearchParams(window.location.search)
      const raw =
        params.get('returnTo') || params.get('return_to') || params.get('next')
      let target = '/auth/google/login'
      if (raw) {
        try {
          const decoded = decodeURIComponent(raw)
          if (
            decoded.startsWith('/') &&
            !decoded.startsWith('//') &&
            !decoded.startsWith('/\\')
          ) {
            target = `/auth/google/login?returnTo=${encodeURIComponent(decoded)}`
          }
        } catch {
          // fall through to default
        }
      }
      window.location.href = target
    })
  }
}

function bindPasswordToggle() {
  const input = document.querySelector('#password') as HTMLInputElement | null
  const toggle = document.querySelector('#toggle-password') as HTMLButtonElement | null

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

async function bindLoginEvents() {
  const form = document.querySelector('#login-form') as HTMLFormElement | null
  if (!form) return

  let inFlight = false

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (inFlight) return

    hideMessage()

    const email =
      (document.querySelector('#email') as HTMLInputElement | null)?.value.trim().toLowerCase() || ''

    const password =
      (document.querySelector('#password') as HTMLInputElement | null)?.value ?? ''

    if (!email || !password) {
      showMessage('Enter your email and password.')
      return
    }

    const captchaVisible = hasVisibleCaptcha()
    const turnstileToken = captchaVisible ? getTurnstileToken() : ''

    if (captchaVisible && !turnstileToken) {
      showMessage('Complete the security verification to continue.')
      return
    }

    inFlight = true
    setSubmitting(true)

    try {
      const { res, data } = await postLogin(email, password, turnstileToken || undefined)

      if ((res.ok && isSuccessPayload(data)) || (res.ok && !!data?.redirect)) {
        hideCaptcha()

        const ok = await waitForSessionAndRedirect()
        if (!ok) {
          showMessage('You signed in, but the session could not be confirmed.')
        }
        return
      }

      if (backendWantsCaptcha(res, data)) {
        try {
          await showCaptcha()
          showMessage('Verification required. Complete the captcha to continue.')
        } catch (captchaError) {
          console.error('[login] captcha error:', captchaError)
          hideCaptcha()
          showMessage(
            'Security verification could not be loaded. ' +
              'If you use Brave, uBlock, or privacy extensions, ' +
              'try disabling shields for this site and reload.',
          )
        }
        return
      }

      showMessage(getLoginErrorMessage(res, data))
    } catch (error) {
      console.error(error)
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
      // If we arrived with a returnTo (e.g. from /oauth/authorize), honor it
      // so already-logged-in users continue the OAuth connector flow instead
      // of being bounced to /dashboard/ and losing the handshake.
      const params = new URLSearchParams(window.location.search)
      const raw =
        params.get('returnTo') || params.get('return_to') || params.get('next')
      let target = '/dashboard/'
      if (raw) {
        try {
          const decoded = decodeURIComponent(raw)
          if (
            decoded.startsWith('/') &&
            !decoded.startsWith('//') &&
            !decoded.startsWith('/\\')
          ) {
            target = decoded
          }
        } catch {
          // fall through to default
        }
      }
      window.location.replace(target)
    }
  } catch {
    // noop
  }
}

function handleVerifiedNotice() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('verified') !== '1') return

  showMessage('Email verified. You can sign in now.', true)

  params.delete('verified')

  const clean =
    window.location.pathname +
    (params.toString() ? `?${params.toString()}` : '') +
    window.location.hash

  window.history.replaceState({}, document.title, clean)
}
