export async function getSession() {
  const res = await fetch('/api/session', {
    credentials: 'include',
    cache: 'no-store',
  })

  if (!res.ok) return null

  try {
    return await res.json()
  } catch {
    return null
  }
}

// Pick up a post-login destination from the URL so OAuth connector flows
// (Claude.ai / ChatGPT / Gemini) resume at /oauth/authorize after login
// instead of dumping the user on /dashboard/ and dropping the flow.
// Only same-origin, path-like values are accepted so this can never be used
// as an open redirector to a foreign site.
function getSafeReturnTo(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('returnTo') || params.get('return_to') || params.get('next')
    if (!raw) return null
    const decoded = decodeURIComponent(raw)
    // Must start with "/" and not "//" (protocol-relative) or "/\" (edge cases)
    if (!decoded.startsWith('/')) return null
    if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null
    return decoded
  } catch {
    return null
  }
}

export async function waitForSessionAndRedirect() {
  let attempts = 0

  while (attempts < 12) {
    const session = await getSession()

    if (session && (session.authenticated || session.ok)) {
      const target = getSafeReturnTo() || '/dashboard/'
      window.location.href = target
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
    attempts++
  }

  return false
}