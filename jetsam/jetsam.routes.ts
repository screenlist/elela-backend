import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { RecordId, surql } from "@surrealdb/surrealdb"
import { db } from "../database/config.ts";
import { Billing, verifyRequest } from "../utilities.ts";

const billing = new Billing()
const bucket = Deno.env.get('BB_BUCKET')
const jetsam = new Hono<{ Variables: {user: {id: string, table: string}} }>()

jetsam.post('/bridge', async c => {
  try {
    const name = crypto.randomUUID()
    const body = await c.req.formData()
    const file = body.get('pic') as File

    const url = Deno.env.get('APP_ENV') === 'production' ? `https://${Deno.env.get('HOST')}/jetsam/bridge/${name}` : `https://f003.backblazeb2.com/file/${bucket}/${name}`
    return c.json({url})
  } catch (error) {
    console.log(error)
    throw new HTTPException(400, { message: 'Could not upload', cause: error })
  }
})

jetsam.post('/cost', c => {
  const size = c.req.query('size')
  const downloads = c.req.query('downloads') ? Number(c.req.query('downloads')) : 3
  const retention = c.req.query('retention') ? Number(c.req.query('retention')) : 1

  if(!size){ throw new HTTPException(404, { message: 'File size must be proived' }) }

  if(typeof Number(size) !== 'number'){ throw new HTTPException(404, { message: 'File size must be a number' }) }

  return c.json(billing.calculateSubpointForCargo(+size, downloads, retention))
})

jetsam.post('/start', verifyRequest(['sailor']), async c => {
  
})

export default jetsam