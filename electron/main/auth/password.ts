import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Password hashing with scrypt (memory-hard, built into Node: no native module to rebuild).
 * Stored format: `scrypt$N$r$p$salt$hash` (base64), so parameters can be raised later and old
 * hashes still verify.
 */
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const DEFAULT_PARAMS = { N: 32_768, r: 8, p: 1 } as const
const MAX_MEMORY = 128 * 1024 * 1024
const MAX_COST = 1 << 20

function derive(
  password: string,
  salt: Buffer,
  options: ScryptOptions,
  keyLength = KEY_LENGTH
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(plain, salt, { ...DEFAULT_PARAMS, maxmem: MAX_MEMORY })
  const { N, r, p } = DEFAULT_PARAMS
  return `scrypt$${String(N)}$${String(r)}$${String(p)}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nText, rText, pText, saltText, keyText] = parts
  const N = Number(nText)
  const r = Number(rText)
  const p = Number(pText)
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > MAX_COST) return false
  if (saltText === undefined || keyText === undefined) return false

  const expected = Buffer.from(keyText, 'base64')
  if (expected.length === 0) return false
  try {
    const actual = await derive(
      plain,
      Buffer.from(saltText, 'base64'),
      { N, r, p, maxmem: MAX_MEMORY },
      expected.length
    )
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | undefined

/**
 * A valid hash nobody knows the password to. Verifying against it when a username does not exist
 * keeps the response time the same, so timing does not reveal which usernames exist.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}
