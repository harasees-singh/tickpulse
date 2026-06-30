// Dev-only Vite plugin that implements the Kite Connect login flow on the same
// origin as the app (http://127.0.0.1:5173), so the redirect URL
// `http://127.0.0.1:5173/auth/callback` resolves to real server code that can
// safely hold the api_secret. In production, replace these with serverless
// functions at the same paths (Vercel/Cloudflare/etc).
//
//   GET /auth/login    -> 302 to Zerodha's hosted login
//   GET /auth/callback -> exchange request_token -> access_token, set cookie, 302 /
//   GET /auth/session  -> { connected, api_key, access_token, user } (so the SPA
//                          can open wss://ws.kite.trade)
//   GET /auth/logout   -> clear cookie

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { getInstruments, filterInstruments } from './instruments'

const KITE_LOGIN = 'https://kite.zerodha.com/connect/login'
const KITE_TOKEN = 'https://api.kite.trade/session/token'
const COOKIE = 'kite_session'

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function kiteAuth(opts: { apiKey: string; apiSecret: string }): Plugin {
  const { apiKey, apiSecret } = opts
  const configured = Boolean(apiKey && apiSecret)

  return {
    name: 'kite-auth-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1:5173')
        const path = url.pathname
        if (!path.startsWith('/auth/')) return next()

        const json = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        const redirect = (to: string, cookie?: string) => {
          res.statusCode = 302
          res.setHeader('location', to)
          if (cookie) res.setHeader('set-cookie', cookie)
          res.end()
        }

        // ---- session: always JSON so the SPA can poll it ----
        if (path === '/auth/session') {
          if (!configured) return json(200, { connected: false, reason: 'config' })
          const raw = parseCookies(req.headers.cookie)[COOKIE]
          if (!raw) return json(200, { connected: false })
          try {
            const s = JSON.parse(Buffer.from(raw, 'base64').toString())
            return json(200, {
              connected: true,
              api_key: apiKey,
              access_token: s.access_token,
              user_id: s.user_id,
              user_name: s.user_name
            })
          } catch {
            return json(200, { connected: false })
          }
        }

        // ---- instrument search (public dump; no access token required) ----
        if (path === '/auth/instruments') {
          try {
            const rows = await getInstruments()
            return json(200, filterInstruments(rows, {
              q: url.searchParams.get('q') ?? undefined,
              exchange: url.searchParams.get('exchange') ?? undefined,
              limit: Number(url.searchParams.get('limit')) || undefined
            }))
          } catch {
            return json(502, { error: 'instruments_unavailable' })
          }
        }

        if (!configured) return redirect('/?auth=config')

        // ---- start login ----
        if (path === '/auth/login') {
          return redirect(`${KITE_LOGIN}?v=3&api_key=${encodeURIComponent(apiKey)}`)
        }

        // ---- callback: exchange request_token for access_token ----
        if (path === '/auth/callback') {
          const status = url.searchParams.get('status')
          const requestToken = url.searchParams.get('request_token')
          if (status !== 'success' || !requestToken) return redirect('/?auth=denied')

          const checksum = createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex')
          try {
            const r = await fetch(KITE_TOKEN, {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'X-Kite-Version': '3'
              },
              body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum })
            })
            const data: any = await r.json()
            if (data?.status !== 'success' || !data?.data?.access_token) {
              return redirect('/?auth=failed')
            }
            const session = Buffer.from(
              JSON.stringify({
                access_token: data.data.access_token,
                user_id: data.data.user_id,
                user_name: data.data.user_name
              })
            ).toString('base64')
            // Access token is valid only for the trading day; ~max 1 day.
            const cookie = `${COOKIE}=${session}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
            return redirect('/?auth=ok', cookie)
          } catch {
            return redirect('/?auth=error')
          }
        }

        // ---- logout ----
        if (path === '/auth/logout') {
          return redirect('/', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`)
        }

        return next()
      })
    }
  }
}

