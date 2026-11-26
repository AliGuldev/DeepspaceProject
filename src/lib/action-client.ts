import { getAuthToken } from 'deepspace'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown>,
): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in and try again.')

  const response = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  })
  const payload: unknown = await response.json()
  if (!response.ok || !isObject(payload) || payload.success !== true) {
    const message = isObject(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'Please try again.'
    throw new Error(message)
  }
  return payload.data as T
}
