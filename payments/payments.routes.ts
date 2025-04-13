import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { surql } from "@surrealdb/surrealdb"
import { getSurreal } from "../database/config.ts"
import { calculateUnitPrice } from "../utilities.ts"

const db = await getSurreal()
const payments = new Hono()

payments.get('/price', c => {
  const quantity = c.req.query('quantity') ? Number(c.req.query('quantity')) : 3
  console.log(quantity, calculateUnitPrice(quantity))
  return c.json({price: Math.round(quantity * calculateUnitPrice(quantity)*100)/100 })
})

payments.get('/buy', async c => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const quantity = c.req.query('quantity') ? Number(c.req.query('quantity')) : 3
  const email = c.req.query('email')
  if(!email){ throw new HTTPException(404, {message: 'Please provide email'}) }
  const price = ( ( Math.round( quantity * calculateUnitPrice(quantity) * 100 ) / 100 ) * 100 ).toString()
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
        amount: price,
        callback_url: `http://${Deno.env.get('HOST')}/canal/generate?ref=${reference}`,
        reference: reference
      })
    })
    
    if(!response.ok){ throw new HTTPException(404,{ message: 'Could not initiate payment' }) }

    const initiated = await response.json()

    const query = surql`
      CREATE payment_fiat CONTENT {
        amount: ${price},
        points: ${quantity},
        reference_code: ${reference}
      };
    `
    await db.query(query)

    return c.json({ url: initiated.data['authorization_url'] })
  } catch (error) {
    throw new HTTPException(404,{ message: 'Could not initiate payment', cause: error })
  }
})

export default payments