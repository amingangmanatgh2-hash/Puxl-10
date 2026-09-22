import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fetch } from 'undici'
import { paths } from './paths'
import { loadSettings } from './store'

export interface Account {
  id: string
  type: 'offline' | 'microsoft'
  name: string
  uuid: string
  accessToken?: string
  refreshToken?: string
  xuid?: string
  expiresAt?: number
  skinUrl?: string
  addedAt: number
  lastUsed?: number
}

interface AccountStore {
  accounts: Account[]
  activeId: string
}

const FILE = () => path.join(paths().root, 'accounts.json')

export function readAccounts(): AccountStore {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as AccountStore
    if (Array.isArray(raw.accounts)) return raw
  } catch {
    /* first run */
  }
  return { accounts: [], activeId: '' }
}

function writeAccounts(store: AccountStore): void {
  const file = FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function offlineUuid(name: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function validateName(name: string): string | null {
  if (name.length < 3) return 'Username must be at least 3 characters.'
  if (name.length > 16) return 'Username must be 16 characters or fewer.'
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Username may only contain letters, numbers and underscores.'
  return null
}

export function addOfflineAccount(name: string): Account {
  const error = validateName(name)
  if (error) throw new Error(error)
  const store = readAccounts()
  if (store.accounts.some((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('An offline account with that name already exists.')
  }
  const account: Account = {
    id: crypto.randomUUID(),
    type: 'offline',
    name,
    uuid: offlineUuid(name),
    addedAt: Date.now()
  }
  store.accounts.push(account)
  store.activeId = account.id
  writeAccounts(store)
  return account
}

export function removeAccount(id: string): void {
  const store = readAccounts()
  store.accounts = store.accounts.filter((a) => a.id !== id)
  if (store.activeId === id) store.activeId = store.accounts[0]?.id ?? ''
  writeAccounts(store)
}

export function setActiveAccount(id: string): void {
  const store = readAccounts()
  if (!store.accounts.some((a) => a.id === id)) return
  store.activeId = id
  for (const account of store.accounts) if (account.id === id) account.lastUsed = Date.now()
  writeAccounts(store)
}

export function getActiveAccount(): Account | null {
  const store = readAccounts()
  return store.accounts.find((a) => a.id === store.activeId) ?? store.accounts[0] ?? null
}

function upsertAccount(account: Account): Account {
  const store = readAccounts()
  const idx = store.accounts.findIndex((a) => a.id === account.id)
  if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...account }
  else store.accounts.push(account)
  store.activeId = account.id
  writeAccounts(store)
  return account
}

/* ------------------------------------------------------------------ *
 * Microsoft device-code sign-in
 *
 * Requires an Azure application id. Puxl ships without one on purpose —
 * using someone else's client id would be impersonation — so users paste
 * their own free app id in Settings. The flow itself is plain OAuth 2.
 * ------------------------------------------------------------------ */

const SCOPE = 'XboxLive.signin offline_access'

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
  deviceCode: string
  message: string
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text.slice(0, 400) || `HTTP ${res.status}`)
  }
}

function clientId(): string {
  const id = loadSettings().msClientId.trim()
  if (!id) {
    throw new Error(
      'Microsoft sign-in needs an Azure application id. Create a free app at portal.azure.com, enable "Allow public client flows", and paste the id under Settings → Accounts.'
    )
  }
  return id
}

export async function beginMicrosoftLogin(): Promise<DeviceCodeInfo> {
  const body = new URLSearchParams({ client_id: clientId(), scope: SCOPE })
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  const data = await readJson<{
    user_code: string
    device_code: string
    verification_uri: string
    expires_in: number
    interval: number
    message: string
  }>(res as unknown as Response)
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval ?? 5,
    deviceCode: data.device_code,
    message: data.message
  }
}

interface MsTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export async function pollMicrosoftLogin(info: DeviceCodeInfo, signal?: AbortSignal): Promise<Account> {
  const deadline = Date.now() + info.expiresIn * 1000
  const id = clientId()

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Sign-in cancelled.')
    await new Promise((r) => setTimeout(r, Math.max(2, info.interval) * 1000))

    const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: id,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: info.deviceCode
      })
    })
    const data = await readJson<MsTokenResponse>(res as unknown as Response)

    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      info.interval += 2
      continue
    }
    if (data.error === 'expired_token') throw new Error('The sign-in code expired. Start again.')
    if (data.error) throw new Error(data.error_description ?? data.error)
    if (!data.access_token) continue

    return exchangeMicrosoftToken(data.access_token, data.refresh_token, data.expires_in ?? 3600)
  }
  throw new Error('Timed out waiting for Microsoft sign-in.')
}

export async function refreshMicrosoftAccount(account: Account): Promise<Account> {
  if (!account.refreshToken) throw new Error('This account has no refresh token; sign in again.')
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      scope: SCOPE
    })
  })
  const data = await readJson<MsTokenResponse>(res as unknown as Response)
  if (!data.access_token) throw new Error(data.error_description ?? 'Refresh failed')
  return exchangeMicrosoftToken(data.access_token, data.refresh_token ?? account.refreshToken, data.expires_in ?? 3600)
}

async function exchangeMicrosoftToken(msAccessToken: string, refreshToken?: string, expiresIn = 3600): Promise<Account> {
  // 1) Xbox Live
  const xblRes = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  })
  const xbl = await readJson<{ Token: string }>(xblRes as unknown as Response)

  // 2) XSTS
  const xstsRes = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  })
  const xsts = await readJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] }; XErr?: number }>(xstsRes as unknown as Response)
  if (xsts.XErr) {
    const reasons: Record<number, string> = {
      2148916233: 'This Microsoft account has no Xbox profile. Sign in at xbox.com once, then retry.',
      2148916235: 'Xbox Live is not available in your region.',
      2148916236: 'This account needs adult verification.',
      2148916237: 'This account needs adult verification.',
      2148916238: 'This is a child account and must be added to a family first.'
    }
    throw new Error(reasons[xsts.XErr] ?? `Xbox Live error ${xsts.XErr}`)
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs

  // 3) Minecraft services
  const mcRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` })
  })
  const mc = await readJson<{ access_token: string }>(mcRes as unknown as Response)
  if (!mc.access_token) throw new Error('Minecraft services rejected the login.')

  // 4) Profile
  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { authorization: `Bearer ${mc.access_token}` }
  })
  if (profileRes.status === 404) throw new Error('This Microsoft account does not own Minecraft: Java Edition.')
  const profile = await readJson<{ id: string; name: string; skins?: { url: string }[] }>(profileRes as unknown as Response)

  return upsertAccount({
    id: `msa-${profile.id}`,
    type: 'microsoft',
    name: profile.name,
    uuid: profile.id,
    accessToken: mc.access_token,
    refreshToken,
    xuid: uhs,
    expiresAt: Date.now() + expiresIn * 1000,
    skinUrl: profile.skins?.[0]?.url,
    addedAt: Date.now(),
    lastUsed: Date.now()
  })
}

/** Returns a usable token, refreshing when it is close to expiring. */
export async function ensureFreshAccount(account: Account): Promise<Account> {
  if (account.type === 'offline') return account
  if (account.accessToken && account.expiresAt && account.expiresAt - Date.now() > 60_000) return account
  return refreshMicrosoftAccount(account)
}
