import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { RecordId, surql } from '@surrealdb/surrealdb'
import { db } from '../database/config.ts'
import { Billing } from '../utilities.ts'
import { z }  from 'zod'
import { Canal } from "../canal/canal.config.ts";
import { PaymentContent } from "./payments.config.ts"

const payments = new Hono()
const billing = new Billing()

payments.get('/price', async c => {
  const drops = c.req.query('quantity') ? c.req.query('quantity') : 10
  const schema = z.number({coerce: true})
  const quantity =  schema.parse(drops)
  try {
    const unitPriceUSD = billing.calculateUnitPrice(quantity)
    const unitPriceZAR = await billing.convertToTender(unitPriceUSD, 'zar')
    const unitPriceAVAX = await billing.convertToTender(unitPriceUSD, 'avax')

    const priceUSD =  (Math.round(quantity * unitPriceUSD*100)/100).toFixed(2)
    const priceZAR = billing.readableMoney( (Math.round(quantity * unitPriceZAR*100)/100) )
    const priceAVAX = (Math.round(quantity * unitPriceAVAX*10000)/10000).toFixed(4)

    const storageGB = billing.calculateStorageFromSubpoints( billing.flowpointsToSubpoints(quantity) )
    const callMinutes = billing.calculateCallsFromSubpoints( billing.flowpointsToSubpoints(quantity) )
    return c.json({
      price_usd: priceUSD,
      price_zar: priceZAR,
      price_avax: priceAVAX,
      calls: callMinutes,
      storage: storageGB
    })
  } catch (error) {
    throw new HTTPException(404, { message: 'Pricing not found', cause: error })
  }
})

payments.get('/fiat', async c => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const schema = z.object({
    quantity: z.number({coerce: true}).min(10, 'Quantity must be at least 10 or greater'),
    email: z.string().email('Provide a valid email'),
    conduit: z.string().optional()
  })

  const validation = schema.safeParse({
    email: c.req.query('email'),
    quantity: c.req.query('quantity'),
    conduit: c.req.query('conduit')
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const message = ''
    formatted._errors.forEach(val => message.concat(...`${val};`))
    throw new HTTPException(404, { message: message  }) 
  }
 
  const { email, quantity, conduit } = validation.data
  
  const unitPriceUSD = billing.calculateUnitPrice(quantity)
  const unitPriceZAR = await billing.convertToTender(unitPriceUSD, 'zar')
  const price = Math.round( quantity * unitPriceZAR * 100 ) / 100 
  const priceCents = (  price* 100 ).toString()
  const reference = crypto.randomUUID()
  const redirect = `${Deno.env.get('CLIENT_HOST')}/generate/phrase?ref=${reference}`
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
        callback_url: redirect,
        reference: reference
      })
    })
    
    if(!response.ok){ throw new HTTPException(404,{ message: 'Could not initiate payment' }) }

    const initiated = await response.json()

    const paymentContent: PaymentContent = {
      amount: price,
      points: billing.flowpointsToSubpoints(quantity),
      reference_code: reference,
      currency: 'ZAR',
      success: false
    }

    if(conduit){
      const canal = await db.select<Canal>(new RecordId('canal', conduit))
      if(!canal){ throw new HTTPException(404, { message: 'Payment failed, the canal does not exist' }) }
      paymentContent.canal = canal.id
    }

    await db.query(surql`CREATE payment CONTENT ${paymentContent}`)
    return c.json({ url: initiated.data['authorization_url'] })
  } catch (error) {
    throw new HTTPException(404,{ message: 'Could not initiate payment', cause: error })
  }
})

payments.get('/crypto', async c => {
  const schema = z.object({
    quantity: z.coerce.number({message: 'Quantity must be a number'}).min(10, 'Quantity must be at least 10 or greater'),
    conduit: z.string().optional()
  })

  const validation =  schema.safeParse({
    quantity: c.req.query('quantity'),
    conduit: c.req.query('conduit')
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const message = ''
    formatted._errors.forEach(val => message.concat(...`${val};`))
    throw new HTTPException(404, { message: message  }) 
  }

  const { quantity, conduit } = validation.data

  const ref = crypto.randomUUID()
  
  const unitPriceUSD = billing.calculateUnitPrice(quantity)
  const unitPriceAVAX = await billing.convertToTender(unitPriceUSD, 'avax')
  const price = Math.round(quantity * unitPriceAVAX*10000)/10000
  const paymentContent: PaymentContent = {
    amount: price,
    currency: 'AVAX',
    success: false,
    reference_code: ref,
    points: billing.flowpointsToSubpoints(quantity)
  }

  if(conduit){
    const canal = await db.select<Canal>(new RecordId('canal', conduit))
    if(!canal){ throw new HTTPException(404, { message: 'Payment failed, the canal does not exist' }) }
    paymentContent.canal = canal.id
  }

  await db.query(surql`CREATE payment CONTENT ${paymentContent};`)
  return c.json({
    quantity: billing.subpointsToFlowpoints( billing.flowpointsToSubpoints(quantity) ),
    price: price.toFixed(4),
    reference: ref,
    currency: 'AVAX'
  })
})

export default payments