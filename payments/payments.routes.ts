import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { surql } from "@surrealdb/surrealdb"
import { getSurreal } from "../database/config.ts"
import { Billing } from "../utilities.ts"

const db = await getSurreal()
const payments = new Hono()
const billing = new Billing()

payments.get('/price', async c => {
  const quantity = c.req.query('quantity') ? Number(c.req.query('quantity')) : 3
  const currency = c.req.query('currency')

  if(!currency || !['ZAR', 'AVAX'].includes(currency)){ throw new HTTPException(404, { message: 'Currency must be provided and must be either ZAR or AVAX' }) }

  console.log(quantity, billing.calculateUnitPrice(quantity))
  
  try {
    const unitPriceUSD = billing.calculateUnitPrice(quantity)
    const unitPriceCurrency = await billing.convertToTender(unitPriceUSD, currency.toLowerCase() as 'zar' | 'avax')
    const price = currency === 'ZAR' ? (Math.round(quantity * unitPriceCurrency*100)/100).toFixed(2) : (Math.round(quantity * unitPriceCurrency*10000)/10000).toFixed(4)
    return c.json({price})
  } catch (error) {
    throw new HTTPException(404, { message: 'Pricing not found', cause: error })
  }
})

payments.get('/fiat', async c => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const quantity = c.req.query('quantity') ? Number(c.req.query('quantity')) : 10
  const email = c.req.query('email')
  if(!email){ throw new HTTPException(404, {message: 'Please provide email'}) }
  if(quantity < 10){ throw new HTTPException(404, {message: 'Flow points quantity must be at least 10'}) }
  const unitPriceUSD = billing.calculateUnitPrice(quantity)
  const unitPriceZAR = await billing.convertToTender(unitPriceUSD, 'zar')
  const price = Math.round( quantity * unitPriceZAR * 100 ) / 100 
  const priceCents = (  price* 100 ).toString()
  const reference = crypto.randomUUID()
  try {
    const response = await fetch(`${paystackUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: decodeURIComponent(email),
        currency: 'ZAR',
        amount: priceCents,
        callback_url: `http://${Deno.env.get('HOST')}/canal/generate?ref=${reference}`,
        reference: reference
      })
    })
    
    if(!response.ok){ throw new HTTPException(404,{ message: 'Could not initiate payment' }) }

    const initiated = await response.json()

    const query = surql`
      CREATE payment CONTENT {
        amount: ${price},
        points: ${billing.flowpointsToSubpoints(quantity)},
        reference_code: ${reference},
        currency: 'ZAR',
        success: false
      };
    `
    await db.query(query)

    return c.json({ url: initiated.data['authorization_url'] })
  } catch (error) {
    throw new HTTPException(404,{ message: 'Could not initiate payment', cause: error })
  }
})

payments.post('/crypto', async c => {
  const quantity = c.req.query('quantity') ? Number(c.req.query('quantity')) : 10
  if(quantity < 10){ throw new HTTPException(404, {message: 'Flow points quantity must be at least 10'}) }
  const ref = crypto.randomUUID()
  try {
    const unitPriceUSD = billing.calculateUnitPrice(quantity)
    const unitPriceAVAX = await billing.convertToTender(unitPriceUSD, 'avax')
    const price = Math.round(quantity * unitPriceAVAX*10000)/10000
    const paymentContent = {
      amount: price,
      currency: 'AVAX',
      success: false,
      reference_code: ref,
      points: billing.flowpointsToSubpoints(quantity)
    }
    await db.query(surql`CREATE payment CONTENT ${paymentContent};`)
    return c.json({
      quantity: billing.flowpointsToSubpoints(quantity),
      price: price,
      reference: ref,
      currency: 'AVAX'
    })
  } catch (error) {
    throw new HTTPException(404,{ message: 'Could not initiate payment', cause: error })
  }
})

export default payments