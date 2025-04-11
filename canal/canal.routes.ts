import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { RecordId, surql } from "@surrealdb/surrealdb"
import { SignJWT } from '@panva/jose'
import { promisify } from "node:util"
import { timingSafeEqual } from "node:crypto"
import { getSurreal } from "../database/config.ts"
import { diceware, emojiware, encodeHMAC, verifyHMAC, verifyRequest, hexToBytes } from "../utilities.ts"
import { PaymentFiat } from "../payments/payments.config.ts";
import { Canal, Bridge, RequestsTo, Wave, ConnectsWith  } from "./canal.config.ts";

const db = await getSurreal()
const canal = new Hono<{ Variables: {user: {id: string, table: string}} }>()

canal.get('/', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const canal =  await db.select<Canal>(new RecordId(user.table, user.id))
  const bridges = (await db.query<[Bridge[]]>(surql`SELECT * FROM bridge WHERE canal = ${new RecordId(user.table, user.id)}`))[0]
  return c.json({
    usage: {
      capacity: canal.capacity,
      usage: canal.usage,
      is_premium: canal.is_premium,
    },
    bridges
  })
})

canal.get('/generate', async (c) => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const ref = c.req.query('ref')
  try {
    const canal = (await diceware(6)).join(' ')
    const canalHash = await encodeHMAC(canal)

    if(ref){
      const res = await fetch(`${paystackUrl}/transaction/verify/${ref}`, {method: 'GET', headers: {'Authorization': `Bearer ${paystackSecret}`}})
      const transaction = await res.json()
      if(transaction.data.status !== 'success'){ throw new HTTPException(404,{ message: 'Payment not valid, could not generate canal.' })  }
      const payment = (await db.query<[PaymentFiat[]]>(surql`SELECT * FROM payment_fiat WHERE reference_code = ${ref};`))[0][0]
      if(payment.success === true){ throw new HTTPException(404,{ message: 'Payment value has already been redeemed.' }) }
      await db.query(surql`UPDATE ${payment.id} SET success = ${true}, updated_at = ${new Date()}, transaction_id = ${transaction.data.id};`)

      const content = {
        standard_usage: 0,
        standard_capacity: 0,
        premium_usage: 0,
        premium_capacity: payment.points,
        passphrase: canalHash
      }
      await db.query(surql`CREATE canal CONTENT ${content};`)
    } else {
      const content = {
        standard_usage: 0,
        standard_capacity: 1,
        premium_usage: 0,
        premium_capacity: 0,
        passphrase: canalHash
      }
      await db.query(surql`CREATE canal CONTENT ${content};`)
    }

    return c.json(canal)
  } catch (error) {
    throw new HTTPException(404,{ message: 'Could not generate canal.', cause: error })
  }
})

canal.post('/auth', async c => {
  const encoder = new TextEncoder()
  try {
    const data = await c.req.json()
    const phrase: string = data['phrase']
    if(!phrase){ throw new HTTPException(404, { message: 'No canal phrase was provided.' }) }
    const phraseHash = await encodeHMAC(phrase)
    const getCanal = (await db.query<[Canal[]]>(surql`SELECT * FROM canal WHERE passphrase = ${phraseHash} LIMIT 1;`))[0]
    const isAuthentic = await verifyHMAC(phrase, getCanal[0].passphrase)
    if(getCanal.length < 1 || isAuthentic === false){ throw new HTTPException(400, { message: 'Authorisarion failed' }) }
    if(getCanal[0].capacity - getCanal[0].usage === 0){
      throw new HTTPException(400, { message: 'Maximum usage reached.' })
    }
    const canalId = getCanal[0].id.toString().split(':')[1]
    const jwtSecret = Deno.env.get('JWT_SECRET')
    const jwtExpiration = Deno.env.get('JWT_EXPIRATION_TIME')
    if(!jwtExpiration || !jwtSecret){ throw new HTTPException(400, { message: 'Access token could not be generated' }) }
    const encodedSecret =  encoder.encode(jwtSecret)
    const token = await new SignJWT({ id: canalId, role: 'sailor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(jwtExpiration).sign(encodedSecret)
    
    return c.json({
      id: canalId,
      access_token: token
    })
  } catch (error) {
    throw new HTTPException(400,{ message: 'Authorisation failed', cause: error })
  }
}) 

canal.post('/bridge', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  try {
    const { flare, start_time } = await c.req.json()
    const canal =  await db.select<Canal>(new RecordId(user.table, user.id))
    if(canal.capacity - canal.usage === 0){ throw new HTTPException(400, { message: 'Canal usage has reached maximum usage' }) }
    const start = new Date(start_time).valueOf()
    const end = start + 1000*60*20
    const code = emojiware(2)+' '+flare+' '+emojiware(4)
    const bridgeContent = {
      canal: canal.id,
      public_code: code,
      start_time: new Date(start),
      end_time: new Date(end)
    }
    const [newBridge] = await db.query<[Bridge[], Canal[]]>(surql`CREATE bridge CONTENT ${bridgeContent}; UPDATE ${canal.id} SET usage = ${canal.usage++};`)
    return c.json(newBridge[0])
  } catch (error) {
    throw new HTTPException(400, { message: 'Chat could not be created', cause: error })
  }
})

canal.get('/bridge/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  try {
    const bridge = await db.select<Bridge>(new RecordId('bridge', id))
    if(bridge.canal !== new RecordId(user.table, user.id)){ throw new HTTPException(403, { message: 'You are not authorised to access this recource' }) }
    const waves = (await db.query<[{count: number}[]]>(surql`SELECT count() FROM requests_to WHERE out = ${bridge.id} GROUP BY count;`))[0][0]
    return c.json({
      bridge: bridge,
      waves: waves.count
    })
  } catch (error) {
    throw new HTTPException(404, { message: 'Chat not found', cause: error })
  }
})

canal.post('/bridge/:id/connect', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  try {
    const { counterflare } = await c.req.json()
    const bridge = await db.select<Bridge>(new RecordId('bridge', id))
    const canal = await db.select<Canal>(new RecordId('canal', id))
    if(bridge.canal !== new RecordId(user.table, user.id)){ throw new HTTPException(403, { message: 'You are not authorised to access this recource' }) }
    const wave = (await db.query<[Wave[]]>(surql`SELECT * FROM wave WHERE public_code = ${counterflare} LIMIT 1;`))[0][0]
    if(!wave){ throw new HTTPException(400, { message: 'The Wave does not exist' }) }
    const connects = (await db.query<[{count: number}[]]>(surql`SELECT count() FROM connects_with WHERE out = ${bridge.id} GROUP BY count;`))[0][0]
    if(connects.count > 0 && canal.is_premium === false){ throw new HTTPException(400, { message: 'You Canal does not allow the capacity for a Bridge to connect with more than 1 Wave.' }) }
    await db.query(surql`RELATE ${wave.id}->connects_with->${bridge.id};`)
    if(connects.count > 1 && canal.capacity - canal.usage > 0){
      await db.query(surql`UPDATE ${canal.id} SET usage = ${canal.usage++};`)
    }
    return c.json({connection: 'successful'})
  } catch (error) {
    throw new HTTPException(400, { message: 'Bridge and Wave connection could not be made', cause: error })
  }
})

canal.get('/bridge/:id/connections', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  try {
    const bridge = await db.select<Bridge>(new RecordId('bridge', id))
    if(bridge.canal !== new RecordId(user.table, user.id)){ throw new HTTPException(403, { message: 'You are not authorised to access this recource' }) }
    const connections = (await db.query<[ConnectsWith[]]>(surql`SELECT * FROM connects_with WHERE out = ${id};`))[0]
    return c.json(connections)
  } catch (error) {
    throw new HTTPException(404, { message: 'The connections could not be retrived', cause: error })
  }
})

canal.post('/wave', async c => {
  try {
    const { anchor, counterflare, flare } = await c.req.json()
    const bridge = (await db.query<[Bridge[]]>(surql`SELECT * FROM bridge WHERE public_code = ${flare} LIMIT 1;`))[0][0]
    if(!bridge){ throw new HTTPException(400, { message: 'Action not allowed' }) }
    const { scrypt } = await import('node:crypto')
    const scryptAsync = promisify(scrypt) as (
      password: string | Uint8Array,
      salt: string | Uint8Array,
      keylen: number
    ) => Promise<Uint8Array>

    const salt = crypto.randomUUID()
    const derivedKey = await scryptAsync(anchor, salt, 64)
    const secretCode = Array.from(derivedKey).map((byte) => byte.toString(16).padStart(2, "0")).join("")
    const publicCode = emojiware(2)+counterflare+emojiware(4)
    const waveContent = {
      secret_salt: salt,
      secret_code: secretCode,
      public_code: publicCode
    }
    const newWave = (await db.query<[Wave[]]>(surql`CREATE wave CONTENT ${waveContent};`))[0][0]
    await db.query<[RequestsTo[]]>(surql`RELATE ${newWave.id}->requests_to->${bridge.id};`)
    
    return c.json({
      counterflare: newWave.public_code,
      start_time: bridge.start_time
    })
  } catch (error) {
    throw new HTTPException(400, { message: 'Wave not recorded', cause: error })
  }
})

canal.post('/wave/auth', async c => {
  const encoder = new TextEncoder()
  try {
    const { anchor, counterflare, flare } = await c.req.json()
    const [one, two] = await db.query<[Bridge[], Wave[]]>(surql`
      SELECT * FROM bridge WHERE public_code = ${flare} LIMIT 1; 
      SELECT * FROM wave WHERE public_code = ${counterflare} LIMIT 1;
    `)
    const bridge = one[0]
    const wave = two[0]

    const connection = (await db.query<[{count: number}[]]>(surql`SELECT count() FROM connects_with WHERE in = ${wave.id}, out = ${bridge.id} LIMIT 1;`))[0][0]

    if(!bridge){ throw new HTTPException(400, { message: 'This bridge has collapsed' }) }
    if(!wave){  throw new HTTPException(400,  { message: 'This wave has stopped' }) }

    const { scrypt } = await import('node:crypto')
    const scryptAsync = promisify(scrypt) as (
      password: string | Uint8Array,
      salt: string | Uint8Array,
      keylen: number
    ) => Promise<Uint8Array>
    const provideSecret = await scryptAsync(anchor, wave.secret_salt, 64)
    const storedSecret = hexToBytes(wave.secret_code)
    const match = timingSafeEqual(storedSecret, provideSecret)

    if(match === false){ throw new HTTPException(400, { message: 'This wave does not recognise the anchor' }) }

    if(connection.count === 1){
      const waveId = wave.id.id
      const jwtSecret = Deno.env.get('JWT_SECRET')
      const jwtExpiration = new Date(bridge.end_time)
      if(!jwtExpiration || !jwtSecret){ throw new HTTPException(400, { message: 'Access token could not be generated' }) }
      const encodedSecret =  encoder.encode(jwtSecret)
      const token = await new SignJWT({ id: waveId, role: 'seafarer' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(jwtExpiration).sign(encodedSecret)

      return c.json({
        approved: true,
        access_token: token,
        connection_path: `/connection/${wave.id.id}:${bridge.id.id}`,
        start_time: bridge.start_time
      })
    } else {
      return c.json({
        approved: false,
        access_token: null,
        connection_path: null,
        start_time: bridge.start_time
      })
    }
  } catch (error) {
    throw new HTTPException(400, { message: 'Wave not recorded', cause: error })
  }
})

export default canal