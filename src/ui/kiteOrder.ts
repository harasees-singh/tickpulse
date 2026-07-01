import { session } from '../core/session'

const KITE_BASKET = 'https://kite.zerodha.com/connect/basket'

// Open the Zerodha Kite order ticket for a symbol via the Kite "basket"
// publisher endpoint: a form POST (api_key + a one-order JSON) opens Kite in a
// new tab with the Buy/Sell ticket pre-filled for the user to confirm/place.
// Requires a live session (api_key); in demo mode we just open Kite so the
// action never dead-ends.
export function openKiteOrder(tx: 'BUY' | 'SELL', tradingsymbol: string, exchange: string): void {
  const apiKey = session()?.api_key
  if (!apiKey) {
    window.open('https://kite.zerodha.com/', '_blank', 'noopener')
    return
  }
  const data = JSON.stringify([
    {
      variety: 'regular',
      tradingsymbol,
      exchange,
      transaction_type: tx,
      order_type: 'MARKET',
      quantity: 1,
      readonly: false
    }
  ])
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = KITE_BASKET
  form.target = '_blank'
  const hidden = (name: string, value: string) => {
    const el = document.createElement('input')
    el.type = 'hidden'
    el.name = name
    el.value = value
    form.appendChild(el)
  }
  hidden('api_key', apiKey)
  hidden('data', data)
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

