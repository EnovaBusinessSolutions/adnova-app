import adrayIcon from './assets/adray-icon.png'

export function renderConfirmation() {
  const root = document.querySelector('#login-root') as HTMLDivElement | null
  if (!root) return

  const email = getEmailFromQuery()

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
      <div class="login-card confirmation-card">
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

        <div class="confirmation-shell">
          <div class="confirmation-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" class="confirmation-icon-svg">
              <path
                d="M3.75 7.5L10.94 12.533c.636.445.954.667 1.291.753a2.25 2.25 0 0 0 1.038 0c.337-.086.655-.308 1.291-.753L21.75 7.5"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M6.45 19.5h11.1c1.68 0 2.52 0 3.162-.327a3 3 0 0 0 1.311-1.311c.327-.642.327-1.482.327-3.162V9.3c0-1.68 0-2.52-.327-3.162a3 3 0 0 0-1.311-1.311C20.07 4.5 19.23 4.5 17.55 4.5H6.45c-1.68 0-2.52 0-3.162.327a3 3 0 0 0-1.311 1.311C1.65 6.78 1.65 7.62 1.65 9.3v5.4c0 1.68 0 2.52.327 3.162a3 3 0 0 0 1.311 1.311C3.93 19.5 4.77 19.5 6.45 19.5Z"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>

          <h1 class="login-heading confirmation-heading">Confirm your email</h1>

          <div class="confirmation-copy">
            <p class="confirmation-lead">
              We sent a verification link to your email address.
            </p>

            ${
              email
                ? `<p class="confirmation-email">${escapeHtml(email)}</p>`
                : ''
            }

            <p class="confirmation-body">
              Check your inbox and click the verification link to activate your account.
            </p>

            <p class="confirmation-footnote">
              If you don’t see it, check your spam or promotions folder.
            </p>
          </div>

          <div class="confirmation-actions">
            <button id="open-mail-btn" class="btn btn-primary" type="button">
              Open email
            </button>

            <button id="go-login-btn" class="btn btn-secondary" type="button">
              Go to login
            </button>
          </div>
        </div>
      </div>
    </div>
  `

  bindConfirmationEvents()
}

function bindConfirmationEvents() {
  const openMailBtn = document.querySelector('#open-mail-btn') as HTMLButtonElement | null
  const goLoginBtn = document.querySelector('#go-login-btn') as HTMLButtonElement | null

  if (openMailBtn) {
    openMailBtn.addEventListener('click', () => {
      const email = getEmailFromQuery()
      const providerUrl = getMailboxUrl(email)

      if (providerUrl) {
        window.open(providerUrl, '_blank', 'noopener,noreferrer')
        return
      }

      window.location.href = '/login'
    })
  }

  if (goLoginBtn) {
    goLoginBtn.addEventListener('click', () => {
      window.location.href = '/login'
    })
  }
}

function getEmailFromQuery(): string {
  const params = new URLSearchParams(window.location.search)
  return (params.get('email') || '').trim()
}

function getMailboxUrl(email: string): string {
  const normalized = email.toLowerCase()

  if (!normalized) return 'https://mail.google.com'

  if (
    normalized.includes('@gmail.com') ||
    normalized.includes('@googlemail.com')
  ) {
    return 'https://mail.google.com'
  }

  if (
    normalized.includes('@outlook.com') ||
    normalized.includes('@hotmail.com') ||
    normalized.includes('@live.com') ||
    normalized.includes('@msn.com')
  ) {
    return 'https://outlook.live.com/mail/'
  }

  if (
    normalized.includes('@icloud.com') ||
    normalized.includes('@me.com') ||
    normalized.includes('@mac.com')
  ) {
    return 'https://www.icloud.com/mail'
  }

  if (normalized.includes('@yahoo.com')) {
    return 'https://mail.yahoo.com'
  }

  return ''
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}