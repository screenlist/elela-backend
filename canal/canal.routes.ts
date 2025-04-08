import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { surql } from "@surrealdb/surrealdb"
import { getSurreal } from "../database/config.ts"
import { diceware, emojiware, encodeHMAC, verifyHMAC } from "../utilities.ts"
import { PaymentFiat } from "../payments/payments.config.ts";

const db = await getSurreal()
const canal = new Hono()

canal.get('/canal/generate', async (c) => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const ref = c.req.query('ref')
  try {
    const canal = await diceware(6)
    const canalHash = await encodeHMAC(name)

    if(ref){
      const res = await fetch(`${paystackUrl}/transaction/verify/${ref}`, {method: 'GET', headers: {'Authorization': `Bearer ${paystackSecret}`}})
      const transaction = await res.json()
      if(transaction.data.status !== 'success'){ throw new HTTPException(400,{ message: 'Payment not valid, could not generate canal.' })  }
      const payment = (await db.query<[PaymentFiat[]]>(surql`SELECT * FROM payment_fiat WHERE reference_code = ${ref};`))[0][0]
      if(payment.success === true){ throw new HTTPException(400,{ message: 'Payment value has already been redeemed.' }) }
      await db.query(surql`UPDATE ${payment.id} SET success = ${true}, updated_at = ${new Date()}, transaction_id = ${transaction.data.id};`)

      const content = {
        standard_usage: 0,
        standard_capacity: 0,
        premium_usage: 0,
        premium_capacity: payment.points,
        passphrase: canalHash
      }
      await db.query(surql`CREATE account CONTENT ${content};`)
    } else {
      const content = {
        standard_usage: 0,
        standard_capacity: 1,
        premium_usage: 0,
        premium_capacity: 0,
        passphrase: canalHash
      }
      await db.query(surql`CREATE account CONTENT ${content};`)
    }

    return c.json(canal)
  } catch (error) {
    throw new HTTPException(400,{ message: 'Could not generate canal.', cause: error })
  }
})

export default canal