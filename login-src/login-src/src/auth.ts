export type LoginResponse = {
  success?: boolean
  ok?: boolean
  authenticated?: boolean
  redirect?: string
  requiresCaptcha?: boolean
  code?: string
  errorCodes?: string[]
  message?: string
  error?: string
}

export type LoginResult = {
  res: Response
  data: LoginResponse | null
  endpoint: string
}

const LOGIN_ENDPOINTS = [
  '/api/login',
  '/login',
  '/api/auth/login',
] as const

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase()
}

function normalizePassword(password: string) {
  return String(password || '')
}

function buildPayload(
  email: string,
  password: string,
  turnstileToken?: string,
): Record<string, string> {
  const payload: Record<string, string> = {
    email: normalizeEmail(email),
    password: normalizePassword(password),
  }

  if (turnstileToken && String(turnstileToken).trim()) {
    payload.turnstileToken = String(turnstileToken).trim()
  }

  return payload
}

async function parseLoginResponse(res: Response): Promise<LoginResponse | null> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('application/json')) {
    try {
      return (await res.json()) as LoginResponse
    } catch {
      return null
    }
  }

  try {
    const text = await res.text()
    if (!text) return null

    return {
      success: res.ok,
      ok: res.ok,
      message: text,
    }
  } catch {
    return null
  }
}

export function isSuccessPayload(data: LoginResponse | null) {
  if (!data) return false
  return data.success === true || data.ok === true || data.authenticated === true
}

export function backendWantsCaptcha(res: Response, data: LoginResponse | null) {
  if (data?.requiresCaptcha === true) return true
  if (data?.code === 'TURNSTILE_REQUIRED_OR_FAILED') return true
  if (data?.code === 'TURNSTILE_FAILED') return true

  if (Array.isArray(data?.errorCodes) && data.errorCodes.length > 0) {
    return true
  }

  if (res.status === 429 && data?.requiresCaptcha) {
    return true
  }

  return false
}

export function getLoginErrorMessage(res: Response, data: LoginResponse | null) {
  if (data?.message) return data.message
  if (data?.error) return data.error

  if (res.status === 401) return 'Correo o contraseña incorrectos.'
  if (res.status === 403) return 'Tu correo aún no está verificado. Revisa tu bandeja de entrada.'
  if (res.status === 400) return 'No se pudo iniciar sesión.'
  if (res.status >= 500) return 'Error del servidor.'

  return `No se pudo iniciar sesión (HTTP ${res.status}).`
}

async function postLoginToEndpoint(
  endpoint: string,
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<LoginResult> {
  const payload = buildPayload(email, password, turnstileToken)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(payload),
  })

  const data = await parseLoginResponse(res)
  return { res, data, endpoint }
}

export async function postLogin(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<LoginResult> {
  let lastResult: LoginResult | null = null

  for (const endpoint of LOGIN_ENDPOINTS) {
    const result = await postLoginToEndpoint(endpoint, email, password, turnstileToken)
    lastResult = result

    if (result.res.status === 404 || result.res.status === 405) {
      continue
    }

    return result
  }

  if (lastResult) return lastResult

  throw new Error('No se encontró un endpoint de login disponible.')
}