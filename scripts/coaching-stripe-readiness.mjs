import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY || ''
const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || ''
const webhookSecret = process.env.STRIPE_COACHING_WEBHOOK_SECRET || ''

if (!secretKey.startsWith('sk_live_')) throw new Error('stripe_secret_key_missing_or_not_live')
if (!publishableKey.startsWith('pk_live_')) throw new Error('stripe_publishable_key_missing_or_not_live')
if (!webhookSecret.startsWith('whsec_')) throw new Error('stripe_webhook_secret_missing')

const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 })
const account = await stripe.accounts.retrieve()

const expectedPrices = new Map([
  ['price_1U19v2Ckb0oA7GrjSUZaJhmB', 9700],
  ['price_1U19vNCkb0oA7GrjvsADONSQ', 24700],
  ['price_1U19vQCkb0oA7GrjHAFdnuKP', 59100],
  ['price_1U19vUCkb0oA7GrjCajl0TvO', 88200],
  ['price_1U19vaCkb0oA7GrjPauZaf7h', 17700],
  ['price_1U19veCkb0oA7GrjtOHiSW9A', 31800],
  ['price_1U19vhCkb0oA7Grji5KCneSB', 58800],
])

const prices = await Promise.all([...expectedPrices.keys()].map((id) => stripe.prices.retrieve(id)))
for (const price of prices) {
  if (!price.active) throw new Error(`stripe_price_inactive:${price.id}`)
  if (price.currency !== 'eur') throw new Error(`stripe_price_currency_invalid:${price.id}`)
  if (price.unit_amount !== expectedPrices.get(price.id)) throw new Error(`stripe_price_amount_invalid:${price.id}`)
  if (price.tax_behavior !== 'inclusive') throw new Error(`stripe_price_tax_behavior_invalid:${price.id}`)
}

console.log(JSON.stringify({
  stripe: 'ready',
  account: account.id,
  charges_enabled: account.charges_enabled,
  payouts_enabled: account.payouts_enabled,
  prices: prices.length,
  webhook_secret: 'configured',
}))
