import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { RecordId, surql } from "@surrealdb/surrealdb"
import { db } from "../database/config.ts";
import { Billing, verifyRequest } from "../utilities.ts"
import { encodeBase64 } from "@std/encoding"
import { z }  from 'zod'
import { Cargo, UploadSession } from "./jetsam.config.ts";
import { Canal } from "../canal/canal.config.ts";

const billing = new Billing()
const bucket = Deno.env.get('BB_BUCKET_ID')
const endpoint = Deno.env.get('BB_ENDPOINT')
const keys = () => {
  const id = Deno.env.get('BB_KEY_ID')
  const key = Deno.env.get('BB_KEY')
  if(!id || !key){ throw new HTTPException(400, { message: 'The object storage cannot be reached' }) }

  return encodeBase64(`${id}:${key}`)
}
const jetsam = new Hono<{ Variables: {user: {id: string, table: 'canal' | 'wave', session: string}} }>()

// jetsam.post('/bridge', async c => {
//   try {
//     const name = crypto.randomUUID()
//     const body = await c.req.formData()
//     const file = body.get('pic') as File

//     const url = Deno.env.get('APP_ENV') === 'production' ? `https://${Deno.env.get('HOST')}/jetsam/bridge/${name}` : `https://f003.backblazeb2.com/file/${bucket}/${name}`
//     return c.json({url})
//   } catch (error) {
//     console.log(error)
//     throw new HTTPException(400, { message: 'Could not upload', cause: error })
//   }
// })

jetsam.post('/cost', c => {
  const size = c.req.query('size')
  const downloads = c.req.query('downloads') ? Number(c.req.query('downloads')) : 3
  const retention = c.req.query('retention') ? Number(c.req.query('retention')) : 1

  if(!size){ throw new HTTPException(404, { message: 'File size must be proived' }) }

  if(typeof Number(size) !== 'number'){ throw new HTTPException(404, { message: 'File size must be a number' }) }

  return c.json(billing.calculateSubpointForCargo(+size, downloads, retention))
})

jetsam.post('/start', verifyRequest(['sailor']), async c => {
  if(!endpoint){ throw new HTTPException(400, { message: 'The object storage endpoint was not found' }) }
  const user = c.get('user')

  const schema = z.object({
    sha1: z.string({ message: 'Provide a SHA1 hash of the file' }),
    type: z.string({ message: 'Provide the content type of the file' }),
    name: z.string({ message: 'Provide the file name' }),
    size: z.number({ message: 'Provide the file size', coerce: true }).min(1, 'File size must be at least 1 byte'),
    downloads: z.number({ message: 'Provide the desired number of downloads', coerce: true }).min(3, 'Every file is required to have at 3 downloads'),
    retention: z.number({ message: 'Provide the desired number of retention months', coerce: true }).min(1, 'Every file must have at least 1 months of retention'),
    chunks: z.number({ message: 'Provide the total number of file chunks', coerce: true }).min(2, 'There must be at least 2 chunks').max(10000, 'There cannot be more than 10 000 chunks')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
    sha1: body.sha1, 
    type: body.type, 
    name: body.name,
    size: body.size,
    downloads: body.downloads,
    retention: body.retention,
    chunks: body.chunks
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.sha1){ formatted.sha1._errors.forEach(val => message.push(val)) }
    if(formatted.type){ formatted.type._errors.forEach(val => message.push(val)) }
    if(formatted.name){ formatted.name?._errors.forEach(val => message.push(val)) }
    if(formatted.size){ formatted.size?._errors.forEach(val => message.push(val)) }
    if(formatted.downloads){ formatted.downloads?._errors.forEach(val => message.push(val)) }
    if(formatted.retention){ formatted.retention?._errors.forEach(val => message.push(val)) }
    if(formatted.chunks){ formatted.chunks?._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const { sha1, name, type, size, downloads, retention, chunks } = validation.data

  const costs = billing.calculateSubpointForCargo(size, downloads, retention)
  const canal = await db.select<Canal>(new RecordId('canal', user.id))
  if( costs.total_subpoints > (canal.capacity - canal.usage) ){ throw new HTTPException(400, { message: 'You have insufficient drops for this action' }) }

  const storage_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_auth = await storage_auth_res.json()
  if(!storage_auth_res.ok){throw new HTTPException(400, { message:  storage_auth.message })}

  const start_file_res = await fetch(endpoint+'/b2api/v4/b2_start_large_file', {
    method: 'POST',
    headers: { 'Authorization': storage_auth.authorizationToken },
    body: JSON.stringify({
      fileName: name,
      contentType: type,
      bucketId: bucket,
      fileInfo: { large_file_sha1: sha1 }
    })
  })
  const start_file = await start_file_res.json()
  if(!start_file_res.ok){ throw new HTTPException(400, { message: start_file.message }) }

  const file_id = start_file.fileId

  const upload_url_one_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_part_url?fileId=${file_id}`, {
    method: 'GET',
    headers: { 'Authorization': storage_auth.authorizationToken }
  })

  const upload_url_two_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_part_url?fileId=${file_id}`, {
    method: 'GET',
    headers: { 'Authorization': storage_auth.authorizationToken }
  })

  const upload_url_one = await upload_url_one_res.json()
  const upload_url_two = await upload_url_two_res.json()

  if(!upload_url_two_res.ok && !upload_url_one_res.ok){ throw new HTTPException(400, { message: 'Could not fetch upload URLs' }) }

  const cargo_content = {
    b2_file_id: file_id,
    subpoints: costs.total_subpoints,
    downloads_count: 0,
    downloads_total: downloads,
    name: name,
    original_filename: name,
    content_type: type,
    sha1: sha1,
    size: size,
    is_complete: false,
    is_independent: true,
    is_public: false,
    storage_valid_until: new Date( Date.now() + ( 1000*60*60*24*30*retention ) )
  }
  const cargo = (await db.query<Array<Cargo[]>>(surql`CREATE cargo CONTENT ${cargo_content};`).catch((err) => {
    throw new HTTPException(400, { message: err.message })
  }))[0][0]

  const session_content = {
    cargo: cargo.id,
    total_chunks: chunks,
    uploaded_chunks: []
  }
  const session = (await db.query<Array<UploadSession[]>>(surql`CREATE upload_session CONTENT ${session_content};`).catch((err) => {
    throw new HTTPException(400, { message: err.message })
  }))[0][0]

  interface Information {
    id: string
    file_id: string
    session_id: string
    links: {
      url: string,
      token: string
    }[]
  }

  const information: Information = {
    id: cargo.id.id.toString(),
    file_id: file_id,
    session_id: session.id.id.toString(),
    links: []
  }

  if(upload_url_one_res.ok){ information.links.push({ url: upload_url_one.uploadUrl, token: upload_url_one.authorizationToken }) }
  if(upload_url_two_res.ok){ information.links.push({ url: upload_url_two.uploadUrl, token: upload_url_two.authorizationToken }) }

  await db.query(surql`UPDATE type::record(${canal.id.toString()}, 'canal') SET usage += ${costs.total_subpoints};`).catch((_err) => {
    throw new HTTPException(400, { message: 'Error updating usage' })
  })

  return c.json(information)
})

export default jetsam