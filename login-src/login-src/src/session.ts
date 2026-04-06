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

export async function waitForSessionAndRedirect() {
  let attempts = 0

  while (attempts < 12) {
    const session = await getSession()

    if (session && (session.authenticated || session.ok)) {
      window.location.href = '/dashboard/'
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
    attempts++
  }

  return false
}