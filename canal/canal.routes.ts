import { Hono } from '@hono/hono'
import { upgradeWebSocket } from '@hono/hono/deno'
import { HTTPException } from '@hono/hono/http-exception'
import { PreparedQuery, RecordId, surql } from '@surrealdb/surrealdb'
import { SignJWT } from '@panva/jose'
import { promisify } from 'node:util'
import { timingSafeEqual } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import { z }  from 'zod'
import { UAParser } from 'ua-parser-js'
import { db } from '../database/config.ts'
import { encodeHMAC, verifyHMAC, verifyRequest, hexToBytes, generateUniquePassphrase, generateUniqueFlare, Obfuscator, Billing } from '../utilities.ts'
import { Payment } from '../payments/payments.config.ts';
import { Canal, Bridge, RequestsTo, Wave, ConnectsWith, Session, Auth, Visit  } from './canal.config.ts';

const canal = new Hono<{ Variables: {user: {id: string, table: 'canal' | 'wave', session: string}} }>()
const billing = new Billing()

canal.get('/', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const canal =  await db.select<Canal>(new RecordId(user.table, user.id))
  if(!canal){ throw new HTTPException(404, { message: 'Canal not found' }) }
  return c.json({
    usage: {
      id: canal.id.id.toString(),
      capacity: canal.capacity,
      usage: canal.usage,
      is_premium: canal.is_premium,
      totp_enabled: canal.totp_enabled,
      created_at: canal.created_at
    }
  })
})

canal.get('/statistics', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const canal =  await db.select<Canal>(new RecordId(user.table, user.id))
  if(!canal){ throw new HTTPException(404, { message: 'Canal not found' }) }
  const scheduled_bridges = await db.query<Array<number>>(surql`RETURN count(SELECT * FROM bridge WHERE canal = ${canal.id} AND start_time > time::now());`)
  const expressed_interest = await db.query<Array<number>>(surql`RETURN count(SELECT * FROM requests_to WHERE out.canal = ${canal.id} AND out.start_time > time::now());`)
  const active_bridges = await db.query<Array<number>>(surql`RETURN count(SELECT * FROM bridge WHERE canal = ${canal.id} AND start_time < time::now() AND end_time > time::now());`)
  return c.json({
    active_bridges: active_bridges[0],
    scheduled_bridges: scheduled_bridges[0],
    expressed_interest: expressed_interest[0]
  })
})

canal.get('/generate', async (c) => {
  const paystackUrl = Deno.env.get('PAYSTACK_URL')
  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')

  const schema = z.object({
    ref: z.string().optional(),
    sender: z.string().optional()
  })

  const {ref, sender} = schema.parse({ ref: c.req.query('ref'), sender: c.req.query('sender')})

  const canal = await generateUniquePassphrase(120)
  const canalHash = await encodeHMAC(canal)

  if(ref && !sender){

    const res = await fetch(`${paystackUrl}/transaction/verify/${ref}`, {method: 'GET', headers: {'Authorization': `Bearer ${paystackSecret}`}})
    const transaction = await res.json()
    if(transaction.data.status !== 'success'){ throw new HTTPException(404,{ message: 'Payment not valid, could not generate canal.' })  }
    const payment = (await db.query<[Payment[]]>(surql`SELECT * FROM payment WHERE reference_code = ${ref};`))[0][0]
    if(payment.success === true){ throw new HTTPException(404,{ message: 'Payment value has already been redeemed.' }) }
    await db.query(surql`UPDATE type::record(${payment.id.toString()}, 'payment') SET success = ${true}, updated_at = ${new Date()}, transaction_id = ${transaction.data.id};`)

    if(payment.canal){
      await db.query(surql`UPDATE type::record(${payment.canal}, 'canal') SET capacity += ${payment.points};`)
      return c.json({ points: billing.subpointsToFlowpoints(payment.points) })
    } else {
      const content = {
        usage: 0,
        capacity: payment.points,
        is_premium: true,
        passphrase: canalHash
      }
      await db.query(surql`CREATE canal CONTENT ${content};`)
      return c.json({passphrase: canal, premium: true})
    }
    
  } if(ref && sender){
    const billing = new Billing()
    const paymentAVAX = await billing.findAVAXPayment(sender, ref)
    if(!paymentAVAX) { throw new HTTPException(404, { message: 'Payment not found' }) }
    const payment = (await db.query<[Payment[]]>(surql`SELECT * FROM payment WHERE reference_code = ${ref};`))[0][0]
    if(payment.success === true){ throw new HTTPException(404,{ message: 'Payment value has already been redeemed.' }) }
    if(payment.amount !== +paymentAVAX.amount){ new HTTPException(404, { message: 'The amount paid does not match the amount quoted' }) }
    await db.query(surql`UPDATE type::record(${payment.id.toString()}, 'payment') SET success = ${true}, updated_at = ${new Date()}, transaction_id = ${paymentAVAX.transactionHash};`)

    if(payment.canal){
      await db.query(surql`UPDATE type::record(${payment.canal}, 'canal') SET capacity += ${payment.points};`)
      return c.json({ points: billing.subpointsToFlowpoints(payment.points) })
    } else {
      const content = {
        usage: 0,
        capacity: payment.points,
        is_premium: true,
        passphrase: canalHash
      }
      await db.query(surql`CREATE canal CONTENT ${content};`)
      return c.json({passphrase: canal, premium: true})
    }
  } else {

    const content = {
      usage: 0,
      capacity: billing.flowpointsToSubpoints(1),
      is_premium: false,
      passphrase: canalHash
    }
    await db.query(surql`CREATE canal CONTENT ${content};`)
    return c.json({passphrase: canal, premium: false})

  }
})

canal.post('/auth', async c => {
  const encoder = new TextEncoder()

  const data = await c.req.json()
  const phrase: string = data['phrase']
  if(!phrase){ throw new HTTPException(404, { message: 'No canal phrase was provided.' }) }
  const phraseHash = await encodeHMAC(phrase)
  const canal = (await db.query<[Canal[]]>(surql`SELECT * FROM canal WHERE passphrase = ${phraseHash} LIMIT 1;`))[0][0]
  if(!canal){ throw new HTTPException(400, { message: 'Authentication failed' }) }
  const isAuthentic = await verifyHMAC(phrase, canal.passphrase)
  if(isAuthentic === false){ throw new HTTPException(400, { message: 'Authentication failed' }) }
  if(canal.capacity - canal.usage === 0 && canal.is_premium === false){
    throw new HTTPException(400, { message: 'Maximum usage reached.' })
  }

  if(canal.totp_enabled){

    const authContent = {
      token: new Obfuscator().generateKey(),
      expires_at: new Date( Date.now() + 1000*60*3 ),
      canal: canal.id
    }
    const auth = (await db.query<[undefined, Auth[]]>(surql`
      LET $exist = count(SELECT * FROM auth WHERE canal = ${canal.id});
      IF $exist > 0 {
        THROW "You can only authenticate every 3 minutes"
      } ELSE {
        LET $new = CREATE auth CONTENT ${authContent};
        RETURN $new;
      };
    `).catch((err) => {
      throw new HTTPException(400, { message: err.message })
    }))[1][0];

    return c.json({
      id: canal.id.id.toString(),
      auth_token: auth.token
    })

  } else {

    const canalId = canal.id.id.toString()
    const jwtSecret = Deno.env.get('JWT_SECRET')
    const jwtExpiration = Deno.env.get('JWT_EXPIRATION_TIME')
    if(!jwtExpiration || !jwtSecret){ throw new HTTPException(400, { message: 'Access token could not be generated' }) }
    const encodedSecret =  encoder.encode(jwtSecret)
    const { os, browser, device } = UAParser(c.req.header('User-Agent'))
    const sessionContent = {
      canal: canal.id,
      browser: browser.name ? browser.name : 'Unknown',
      device: device.type && device.vendor ? `${device.vendor} - ${device.type}` : 'Unknown',
      os: os.name ? os.name : 'Unknown',
      expires_at: new Date( Date.now() + 1000*60*30 )
    }
    const session = (await db.query<Array<Session[]>>(surql`CREATE session CONTENT ${sessionContent};`))[0][0]
    const token = await new SignJWT({ id: canalId, role: 'sailor', sid: session.id.id.toString() }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(jwtExpiration).sign(encodedSecret)
    
    return c.json({
      id: canalId,
      access_token: token
    })

  }
  
})

canal.post('/2fa/verify', async  c => {
  const { auth_token, totp_token } = await c.req.json()

  const auth = (await db.query<Array<Auth[]>>(surql`SELECT * FROM auth WHERE token = ${auth_token};`))[0][0]

  if(!auth){ throw new HTTPException(400, { message: 'The authentication token was not found' }) }
  if(Date.now() > new Date( auth.expires_at ).valueOf() ){ throw new HTTPException(400, { message: 'The authentication token has expired, authenticate again' }) }
  if(auth.attempts < 1){ throw new HTTPException(400, { message: 'Too many attempts, authenticate again' }) }

  const canal = await db.select<Canal>(auth.canal)

  if(!canal.totp_enabled){ throw new HTTPException(400, { message: 'You have not enabled 2FA' }) }
  if(!canal.auth_salt || !canal.auth_secret){ throw new HTTPException(400, { message: 'Your 2FA configuration is not correctly set up' }) }

  const obf = new Obfuscator()
  const key = await obf.deriveKey(canal.auth_salt)
  const secret = await obf.decrypt(canal.auth_secret, key)

  const totp = new OTPAuth.TOTP({
    issuer: 'Elela',
    label: canal.id.id.toString(),
    algorithm: 'SHA1', 
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })

  const validity = totp.validate({token: totp_token, window: 2})
  
  if(validity === null){ 
    await db.query(surql`
      UPDATE type::record(${auth.id.toString()}, 'auth') SET attempts -= 1;
    `)
    throw new HTTPException(400,  { message: 'The token is not valid' }) 
  }

  const encoder = new TextEncoder()
  const jwtSecret = Deno.env.get('JWT_SECRET')
  const jwtExpiration = Deno.env.get('JWT_EXPIRATION_TIME')
  if(!jwtExpiration || !jwtSecret){ throw new HTTPException(400, { message: 'Access token could not be generated' }) }
  const encodedSecret =  encoder.encode(jwtSecret)
  const { os, browser, device } = UAParser(c.req.header('User-Agent'))
  const sessionContent = {
    canal: canal.id,
    browser: browser.name ? browser.name : 'Unknown',
    device: device.type && device.vendor ? `${device.vendor} - ${device.type}` : 'Unknown',
    os: os.name ? os.name : 'Unknown',
    expires_at: new Date( Date.now() + 1000*60*30 )
  }
  const session = (await db.query<Array<Session[]>>(surql`CREATE session CONTENT ${sessionContent};`))[0][0]
  const token = await new SignJWT({ id: canal.id.id.toString(), role: 'sailor', sid: session.id.id.toString() }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(jwtExpiration).sign(encodedSecret)

  return c.json({
    id: canal.id.id.toString(),
    access_token: token
  })
})

canal.post('/2fa/setup', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const canal = await db.select<Canal>(new RecordId('canal', user.id))
  if(canal.totp_enabled){ throw new HTTPException(400, { message: 'You already have 2FA configured' }) }
  if(canal.is_premium === false){ throw new HTTPException(403, { message: 'This feature is for paid canals' }) }
  const totp = new OTPAuth.TOTP({
    issuer: 'Elela',
    label: canal.id.id.toString(),
    algorithm: 'SHA1', 
    digits: 6,
    period: 30
  })
  const secret = totp.secret.base32
  const uri = totp.toString()

  const obf = new Obfuscator()
  const salt = crypto.randomUUID()
  const key = await obf.deriveKey(salt)
  const encryptedSecret = await obf.encrypt(secret, key)

  await db.query(surql`UPDATE type::record(${canal.id.toString()}, 'canal') SET auth_secret = ${encryptedSecret}, auth_salt = ${salt};`)
  const authContent = {
    token: new Obfuscator().generateKey(),
    expires_at: new Date( Date.now() + 1000*60*3 ),
    canal: canal.id
  }
  const auth = (await db.query<[undefined, Auth[]]>(surql`
    LET $exist = count(SELECT * FROM auth WHERE canal = ${canal.id});
    IF $exist > 0 {
      THROW "You can only authenticate every 3 minutes"
    } ELSE {
      LET $new = CREATE auth CONTENT ${authContent};
      RETURN $new;
    };
  `).catch((err) => {
    throw new HTTPException(400, { message: err.message })
  }))[1][0];

  return c.json({ secret: secret, uri: uri, token: auth.token})
})

canal.post('/2fa/enable', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const { auth_token, totp_token } = await c.req.json()
  const canal = await db.select<Canal>(new RecordId('canal', user.id))
  const auth = (await db.query<Array<Auth[]>>(surql`SELECT * FROM auth WHERE token = ${auth_token};`))[0][0]

  if(Date.now() > new Date( auth.expires_at ).valueOf() ){ throw new HTTPException(400, { message: 'The authentication token has expired, authenticate again' }) }
  if(auth.attempts < 1){ throw new HTTPException(400, { message: 'Too many attempts, authenticate again' }) }

  if(canal.totp_enabled){ throw new HTTPException(400, { message: 'You already have 2FA configured' }) }
  if(!canal.auth_salt || !canal.auth_secret){ throw new HTTPException(400, { message: 'Your 2FA configuration is not correctly set up' }) }

  const obf = new Obfuscator()
  const key = await obf.deriveKey(canal.auth_salt)
  const secret = await obf.decrypt(canal.auth_secret, key)

  const totp = new OTPAuth.TOTP({
    issuer: 'Elela',
    label: canal.id.id.toString(),
    algorithm: 'SHA1', 
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })

  const validity = totp.validate({token: totp_token, window: 3})

  if(validity === null){
    await db.query(surql`
      UPDATE type::record(${auth.id.toString()}, 'auth') SET attempts -= 1;
    `)
    throw new HTTPException(400,  { message: 'The token is not valid' })
  }

 await db.query(surql`
    UPDATE type::record(${canal.id.toString()}, 'canal') SET totp_enabled = ${true}, updated_at = time::now();
  `)

  return c.json({ status: 'success' })
})

canal.post('/2fa/disable', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const { totp_token } = await c.req.json()
  const canal = await db.select<Canal>(new RecordId('canal', user.id))

  if(!canal.totp_enabled){ throw new HTTPException(400, { message: 'You have not configured 2FA' }) }
  if(!canal.auth_salt || !canal.auth_secret){ throw new HTTPException(400, { message: 'Your 2FA configuration is not correctly set up, contact support' }) }

  const obf = new Obfuscator()
  const key = await obf.deriveKey(canal.auth_salt)
  const secret = await obf.decrypt(canal.auth_secret, key)

  const totp = new OTPAuth.TOTP({
    issuer: 'Elela',
    label: canal.id.id.toString(),
    algorithm: 'SHA1', 
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })

  const validity = totp.validate({token: totp_token, window: 2})

  if(validity === null){ throw new HTTPException(400,  { message: 'The token is not valid' }) }

  await db.query(surql`
    UPDATE type::record(${canal.id.toString()}, 'canal') SET totp_enabled = ${false}, auth_salt = NONE, auth_secret = NONE, updated_at = time::now();
  `)

  return c.json({ status: 'success' })
})

canal.get('/session/validate', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const session = await db.select<Session>(new RecordId('session', user.session))
  if(!session){ throw new HTTPException(404, { message: 'Session not found' }) }
  return c.json(session)
})

canal.get('/session/all', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const sessions = (await db.query<Array<Session[]>>(surql`SELECT * FROM session WHERE canal = ${new RecordId('canal', user.id)} AND expires_at > time::now();`))[0]
  return c.json(sessions)
})

canal.get('/session/poll', async c => {
  const id = c.req.query('id')
  if(!id){ throw new HTTPException(404, { message: 'Provide the session id' }) }
  const session = await db.select<Session>(new RecordId('session', id))
  if(!session){ throw new HTTPException(404, { message: 'Session not found' }) }
  if(new Date(session.expires_at) < new Date()){ throw new HTTPException(404, { message: 'Session has expired' }) }
  return c.json({
    valid: true,
    expires_at: session.expires_at
  })
})

canal.post('/session/remove', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  await db.delete(new RecordId('session', user.session))
  return c.json({ status: 'success' })
})


canal.post('/bridges', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const schema = z.object({
    flare: z.string().trim().refine(val => {
      const words = val.split(/\s+/)
      return words.length === 2 && words.every((word) => word.length >= 4) && words.every((word) => word.length <= 15)
    }, { message: 'Flare must be exactly two words, each of at least 4 but no more than 15 characters long'}),
    start_time: z.preprocess((arg) => ( typeof arg === 'string' || arg instanceof Date ? new Date(arg) : undefined ), z.date()).refine(val => {
      return val > new Date()
    }, { message: 'You cannot schedule a bridge to a past date' })
  })
  
  const body = await c.req.json()

  const validation = schema.safeParse({flare: body.flare, start_time: body.start_time})

  if(validation.success === false){ 
    const formatted = validation.error.format()
    let message: string = ''
    formatted._errors.forEach(val => message += `${val}; `)
    if(formatted.flare){ formatted.flare._errors.forEach(val => message += `${val}; `) }
    if(formatted.start_time){ formatted.start_time?._errors.forEach(val => message += `${val};`) }
    throw new HTTPException(404, { message: message  }) 
  }

  const { flare, start_time } = validation.data

  const canal =  await db.select<Canal>(new RecordId(user.table, user.id))
  if(canal.capacity - canal.usage <= 0){ throw new HTTPException(400, { message: 'Canal usage has reached maximum usage' }) }
  const start = new Date(start_time).valueOf()
  const end = start + 1000*60*20
  const code = await generateUniqueFlare(flare, 'bridge', 120)
  const bridgeContent = {
    canal: canal.id,
    public_code: code,
    start_time: new Date(start),
    end_time: new Date(end)
  }
  const [newBridge] = await db.query<[Bridge[], Canal[]]>(surql`CREATE bridge CONTENT ${bridgeContent}; UPDATE type::record(${canal.id.toString()}, 'canal') SET usage += ${billing.calculateSubpointForBridge(20).subpoints};`)
  return c.json(newBridge[0])
})

canal.get('/bridges', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const destination = c.req.query('status')

  const schema = z.string().refine(val => {
    return (val === 'active' || val === 'upcoming')
  }, { message: 'The status of the bridges must be either active or upcoming' })

  const validation = schema.safeParse(destination)

  if(validation.success === false){ 
    const formatted = validation.error.format()
    let message: string = ''
    formatted._errors.forEach(val => message += `${val}; `)
    throw new HTTPException(404, { message: message  }) 
  }

  const status = validation.data
  let query: PreparedQuery
  switch(status){
    case 'upcoming':
      query = surql`
        SELECT
        count(<-requests_to<-wave) as responses, 
        count(<-connects_with<-wave) as connections,
        id,
        start_time,
        end_time,
        public_code as flare,
        created_at
        FROM bridge WHERE canal = ${new RecordId('canal', user.id)} AND start_time > time::now() ORDER BY start_time ASC;
      `;
      break;
    case 'active':
      query = surql`
        SELECT
        count(<-requests_to<-wave) as responses, 
        count(<-connects_with<-wave) as connections,
        id,
        start_time,
        end_time,
        public_code as flare,
        created_at
        FROM bridge WHERE canal = ${new RecordId('canal', user.id)} AND start_time < time::now() AND end_time > time::now() ORDER BY start_time ASC;
      `;
      break;
  }

  type WorkingBridge = {
    id: RecordId<string>
    flare: string
    start_time: Date,
    end_time: Date,
    created_at: Date,
    connections: number,
    responses: number
  }

  const bridges = (await db.query<Array<WorkingBridge[]>>(query))[0]

  return c.json(bridges)
})

canal.get('/bridges/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')

  type WorkingBridge = {
    id: RecordId<string>
    flare: string
    start_time: Date,
    end_time: Date,
    created_at: Date,
    connections: number,
    responses: number
  }

  type Connection = {
    id: RecordId<string>,
    connection_id: RecordId<string>
    counterflare: string
  }

  const bridge = (await db.query<Array<WorkingBridge[]>>(surql`
    SELECT
    count(<-requests_to<-wave) as responses, 
    count(<-connects_with<-wave) as connections,
    id,
    start_time,
    end_time,
    public_code as flare,
    created_at
    FROM bridge WHERE canal = ${new RecordId('canal', user.id)} AND id = ${new RecordId('bridge', id)} AND end_time >= time::now();
  `))[0][0]

  if(!bridge){ throw new HTTPException(404, { message: 'The bridge cannot be located' }) }

  const connection = (await db.query<Array<Connection[]>>(surql`
    SELECT id as connection_id, in.id as id, in.public_code as counterflare FROM connects_with WHERE out.id = ${new RecordId('bridge', id)};
  `))[0][0]

  return c.json({bridge, connection})
})

canal.post('/bridges/:id/connect', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const schema = z.string({message: 'Response flare is required'})

  const body = await c.req.json()
  const validation =  schema.safeParse(body.counterflare)

  if(validation.success === false){ 
    const formatted = validation.error.format()
    let message: string = ''
    formatted._errors.forEach(val => message += `${val}; `)
    throw new HTTPException(404, { message: message  }) 
  }

  const counterflare = validation.data

  const bridge = await db.select<Bridge>(new RecordId('bridge', id))
  const canal = await db.select<Canal>(new RecordId('canal', id))
  if(bridge.canal.toString() !== new RecordId(user.table, user.id).toString()){ throw new HTTPException(403, { message: 'You are not authorised to access this recource' }) }
  const wave = (await db.query<[Wave[]]>(surql`SELECT * FROM wave WHERE public_code = ${counterflare} LIMIT 1;`))[0][0]
  if(!wave){ throw new HTTPException(400, { message: 'The Wave does not exist' }) }
  const connects = (await db.query<[number]>(surql`RETURN count(SELECT * FROM connects_with WHERE out = ${bridge.id});`))[0]
  if(connects > 0 && canal.is_premium === false){ throw new HTTPException(400, { message: 'You Canal does not allow the capacity for a Bridge to connect with more than 1 Wave.' }) }
  await db.query(surql`RELATE ${wave.id}->connects_with->${bridge.id};`)
  if(connects > 1 && canal.capacity - canal.usage > 0){
    await db.query(surql`UPDATE type::record(${canal.id.toString()}, 'canal') SET usage = ${++canal.usage};`)
  }
  return c.json({connection: 'successful'})
})

canal.get('/bridges/:id/connections', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')

  const bridge = await db.select<Bridge>(new RecordId('bridge', id))
  if(bridge.canal.toString() !== new RecordId(user.table, user.id).toString()){ throw new HTTPException(403, { message: 'You are not authorised to access this recource' }) }
  const connections = (await db.query<[ConnectsWith[]]>(surql`SELECT * FROM connects_with WHERE out = ${bridge.id};`))[0]
  return c.json(connections)
})

canal.get('/wave', verifyRequest(['seafarer']), async c => {
  const user = c.get('user')
  const connection = (await db.query<Array<ConnectsWith[]>>(surql`SELECT * FROM connects_with WHERE in = ${new RecordId('wave', user.id)};`))[0][0]
  if(!connection){ throw new HTTPException(404, { message: 'No connection was found' }) }
  const bridge = await db.select(connection.out)
  return c.json({
    approved: true,
    access_token: null,
    connection_id: connection.id.id.toString(),
    start_time: bridge.start_time,
    end_time: bridge.end_time
  })
})

canal.post('/wave', async c => {
  const schema = z.object({
    anchor: z.string().trim().refine(val => val.length >= 10, { message: 'The anchor must be at least 10 characters long' }),
    counterflare: z.string().trim().refine(val => {
      const words = val.split(/\s+/)
      return words.length === 2 && words.every((word) => word.length >= 4) && words.every((word) => word.length <= 15)
    }, { message: 'Counterflare must be exactly two words, each of at least 4 but no more than characters long'}),
    flare: z.string()
  })
  
  const body = await c.req.json()
  const validation = schema.safeParse({anchor: body.anchor, counterflare: body.counterflare, flare: body.flare})

  if(validation.success === false){ 
    const formatted = validation.error.format()
    let message: string = ''
    formatted._errors.forEach(val => message += `${val}; `)
    if(formatted.flare){ formatted.flare._errors.forEach(val => message += `${val}; `) }
    if(formatted.counterflare){ formatted.counterflare?._errors.forEach(val => message += `${val}; `) }
    if(formatted.anchor){ formatted.anchor?._errors.forEach(val => message += `${val}; `) }
    throw new HTTPException(404, { message: message  }) 
  }

  const { flare, counterflare, anchor } = validation.data

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
  const publicCode = await generateUniqueFlare(counterflare, 'wave', 120)
  const waveContent = {
    secret_salt: salt,
    secret_code: secretCode,
    public_code: publicCode
  }
  const newWave = (await db.query<[Wave[]]>(surql`CREATE wave CONTENT ${waveContent};`))[0][0]
  await db.query<[RequestsTo[]]>(surql`RELATE ${newWave.id}->requests_to->${bridge.id};`)
  
  return c.json({
    counterflare: newWave.public_code,
    flare: bridge.public_code,
    start_time: bridge.start_time,
    end_time: bridge.end_time
  })
})

canal.post('/wave/auth', async c => {
  const encoder = new TextEncoder()
  const schema = z.object({
    anchor: z.string().trim().refine(val => val.length >= 10, { message: 'The anchor must be at least 10 characters long' }),
    counterflare: z.string(),
    flare: z.string()
  })

  const body = await c.req.json()
  const validation = schema.safeParse({anchor: body.anchor, counterflare: body.counterflare, flare: body.flare})

  if(validation.success === false){ 
    const formatted = validation.error.format()
    let message: string = ''
    formatted._errors.forEach(val => message += `${val}; `)
    if(formatted.flare){ formatted.flare._errors.forEach(val => message += `${val}; `) }
    if(formatted.counterflare){ formatted.counterflare?._errors.forEach(val => message += `${val}; `) }
    if(formatted.anchor){ formatted.anchor?._errors.forEach(val => message += `${val}; `) }
    throw new HTTPException(404, { message: message  }) 
  }

  const { flare, counterflare, anchor } = validation.data

  const [one, two] = await db.query<[Bridge[], Wave[]]>(surql`
    SELECT * FROM bridge WHERE public_code = ${flare} LIMIT 1; 
    SELECT * FROM wave WHERE public_code = ${counterflare} LIMIT 1;
  `)
  const bridge = one[0]
  const wave = two[0]

  if(!bridge){ throw new HTTPException(400, { message: 'This bridge has collapsed' }) }
  if(!wave){  throw new HTTPException(400,  { message: 'This response never reached its destination' }) }

  const session = (await db.query<Array<number>>(surql`RETURN count(SELECT * FROM visit WHERE wave = ${wave.id});`))[0]

  if(session > 0){ throw new HTTPException(400, { message: 'You have an active session, logout first before proceeding' }) }

  const { scrypt } = await import('node:crypto')
  const scryptAsync = promisify(scrypt) as (
    password: string | Uint8Array,
    salt: string | Uint8Array,
    keylen: number
  ) => Promise<Uint8Array>
  const provideSecret = await scryptAsync(anchor, wave.secret_salt, 64)
  const storedSecret = hexToBytes(wave.secret_code)
  const match = timingSafeEqual(storedSecret, provideSecret)

  if(match === false){ throw new HTTPException(400, { message: 'The response or the anchor is wrong' }) }

  const connection = (await db.query<Array<ConnectsWith[]>>(surql`SELECT * FROM connects_with WHERE in = ${wave.id} AND out = ${bridge.id};`))[0][0]

  if(connection){
    const waveId = wave.id.id
    const jwtSecret = Deno.env.get('JWT_SECRET')
    const jwtExpiration = new Date(bridge.end_time)
    if(!jwtExpiration || !jwtSecret){ throw new HTTPException(400, { message: 'Access token could not be generated' }) }
    const encodedSecret =  encoder.encode(jwtSecret)

    const { os, browser, device } = UAParser(c.req.header('User-Agent'))
    const visitContent = {
      wave: wave.id,
      browser: browser.name ? browser.name : 'Unknown',
      device: device.type && device.vendor ? `${device.vendor} - ${device.type}` : 'Unknown',
      os: os.name ? os.name : 'Unknown',
      expires_at: new Date( bridge.end_time )
    }

    const visit = (await db.query<Array<Visit[]>>(surql`CREATE visit CONTENT ${visitContent};`))[0][0]

    const token = await new SignJWT({ id: waveId, sid: visit.id.id.toString(), role: 'seafarer' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(jwtExpiration).sign(encodedSecret)

    return c.json({
      approved: true,
      access_token: token,
      connection_id: connection.id.id.toString(),
      start_time: bridge.start_time,
      end_time: bridge.end_time
    })
  } else {
    return c.json({
      approved: false,
      access_token: null,
      connection_id: null,
      start_time: bridge.start_time,
      end_time: bridge.end_time
    })
  }
})

canal.post('/wave/remove', verifyRequest(['seafarer']), async c => {
  const user = c.get('user')
  await db.delete(new RecordId('visit', user.session))
  return c.json({ status: 'success' })
})

canal.get('/connection/:id', verifyRequest(['sailor', 'seafarer']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  let query: PreparedQuery

  switch(user.table){
    case 'canal':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', id)} AND out.canal = ${new RecordId('canal', user.id)};`
      break;
    case 'wave':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', id)} AND in = ${new RecordId('wave', user.id)};`
      break;
  }

  const is_connected = (await db.query<Array<ConnectsWith[]>>(query))[0][0]

  if(!is_connected){ throw new HTTPException(404, { message: 'Connection not found' }) }

  const bridge = await db.select<Bridge>(is_connected.out)

  c.json({
    connection_id: is_connected.id,
    bridge_id: bridge.id,
    wave_id: is_connected.in,
    start_time: bridge.start_time,
    end_time: bridge.end_time
  })
})

canal.get('/chat/:id', verifyRequest(['sailor', 'seafarer']), async (c, next) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const waveId = id.split(':')[0]
  const bridgeId = id.split(':')[1]
  if(user.table === 'wave' && waveId !== user.id){ throw new HTTPException(403, { message: 'Action not allowed' }) }
  const wave = await db.select<Wave>(new RecordId('wave', waveId))
  const bridge = await db.select<Bridge>(new RecordId('bridge', bridgeId))
  if(!wave || !bridge){ throw new HTTPException(403, { message: 'The connection is not allowed' }) }
  if(user.table === 'canal' && bridge.canal.id !== user.id) { throw new HTTPException(403, { message: 'Action not allowed' }) }
  const connection = (await db.query<[number]>(surql`RETURN count(SELECT * FROM connects_with WHERE in = ${wave.id} AND out = ${bridge.id});`))[0]
  if(connection !== 1){ throw new HTTPException(403, { message: 'The connection is not allowed' }) }
  if(bridge.start_time > new Date()){ throw new HTTPException(403, { message: 'The connection is not active yet' }) }
  if(bridge.end_time < new Date()){ throw new HTTPException(403, { message: 'The connection is not longer active' }) }
  await next()
}, upgradeWebSocket(c => {
  console.log(c.req.path)
  return {
    onMessage: (event, ws) => {
      console.log(event)
      console.log(ws)
      const value = event.data as string
      ws.send(value)
    },
    onOpen: (event, ws) => {
      console.log(event)
      console.log(ws)
      ws.send('Successfully connected')
    },
    onClose: (event, ws) => {
      console.log(event)
      console.log(ws)
      ws.send('One client closed')
    },
    onError: (event, ws) => {
      console.log(event)
      console.log(ws)
      ws.close(1002, `I'm out, peace.`)
    }
  }
}, {
  protocol: 'chat'
}))

export default canal