import { Hono } from '@hono/hono'
import { HTTPException } from '@hono/hono/http-exception'
import { stream } from '@hono/hono/streaming'
import { PreparedQuery, RecordId, surql } from "@surrealdb/surrealdb"
import { db } from "../../database/config.ts";
import { Billing, sanitizeFilename, verifyRequest } from "../../misc/utilities.ts"
import { encodeBase64 } from "@std/encoding"
import { equal } from '@std/assert/equal'
import { z }  from 'zod'
import { Cargo, UploadSession, Information } from "./jetsam.config.ts";
import { Bridge, Canal, ConnectsWith } from "../canal/canal.config.ts";

const bucket = Deno.env.get('BB_BUCKET_ID')
const endpoint = Deno.env.get('BB_ENDPOINT_API')
const keys = () => {
  const id = Deno.env.get('BB_KEY_ID')
  const key = Deno.env.get('BB_KEY')
  if(!id || !key){ throw new Error('The object storage cannot be reached') } 

  return encodeBase64(`${id}:${key}`)
}
const jetsam = new Hono<{ Variables: {user: {id: string, table: 'canal' | 'wave', session: string}} }>()

jetsam.get('/', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 10
  const page = c.req.query('page') ? Number(c.req.query('page')) : 1
  if(limit <= 0 || page <= 0){ throw new HTTPException(404, { message: 'Neither page or limit can be equal or less than zero' }) }
  const start = (page - 1) * limit
  const [cargo, total] = (await db.query<[Cargo[], number]>(surql`
    SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_complete = ${true} AND is_independent = ${true} ORDER BY created_at DESC LIMIT ${limit} START ${start};
    RETURN count(SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_complete = ${true} AND is_independent = ${true});
  `).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not fetch the cargo' })
  }))
  const total_pages = Math.ceil(total/limit)
  return c.json({
    results: cargo,
    navigation: [ (page-1 > 0 ? page-1 : 1), (page < total_pages ? page+1 : page) ],
    has_previous_page: page > 1,
    has_next_page: page < total_pages,
    page_info: `${page} of ${total_pages}`
  })
})

jetsam.get('/unfinished', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const cargo = (await db.query<Array<Cargo[]>>(surql`SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_complete = ${false} AND is_independent = ${true};`).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not fetch the cargo' })
  }))[0]
  return c.json(cargo)
})

jetsam.get('/statistics', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const [total_storage, total_private, total_public, total_cost] = await db.query<[number, number, number, number]>(surql`
    RETURN math::sum(SELECT VALUE size FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_complete = ${true} AND is_independent = ${true});
    RETURN math::sum(SELECT VALUE count(id) as total FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_public = ${false});
    RETURN math::sum(SELECT VALUE count(id) as total FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_public = ${true});
    RETURN math::sum(SELECT VALUE subpoints FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND is_independent = ${true});
  `).catch(error => { throw new HTTPException(404, { message: error.message }) })

  return c.json({
    total_subpoints: total_cost,
    cargo_public: total_public,
    cargo_private: total_private,
    total_size: total_storage
  })
})

// Limit the returned data
jetsam.get('/cargo/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const cargo = (await db.query<Array<Cargo[]>>(surql`SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND id = ${new RecordId('cargo', id)} LIMIT 1;`).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not fetch the cargo' })
  }))[0][0]
  if(!cargo){ throw new HTTPException(404, { message: 'Cargo not found' }) }
  return c.json(cargo)
})

jetsam.get('/cargo/:id/download', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const cargo = (await db.query<Array<Cargo[]>>(surql`SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND id = ${new RecordId('cargo', id)} LIMIT 1;`).catch((_err) => {
    throw new HTTPException(400, { message: 'Could not fetch the cargo' })
  }))[0][0]
  if(!cargo){ throw new HTTPException(404, { message: 'Cargo not found' }) }
  if(cargo.downloads_total - cargo.downloads_count < 1){ throw new HTTPException(404, { message: 'This cargo has run out of downloads' }) }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const file_res = await fetch(`${endpoint}/b2api/v4/b2_download_file_by_id?fileId=${cargo.b2_file_id}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  if(!file_res.ok){
    const error = await file_res.json()
    throw new HTTPException(404, { message:  error.message })
  }

  const cargo_updated = (await db.query<Array<Cargo[]>>(surql`
    UPDATE type::record(${cargo.id.toString()}, 'cargo') SET downloads_count += ${1};
  `).catch((_err) => {
    throw new HTTPException(400, { message: 'Could not fetch the cargo' })
  }))[0][0]

  if(!cargo_updated){ throw new HTTPException(404, { message: 'Cargo download count could not be updated' }) }

  c.header('Content-Disposition', 'attachment')
  c.header('Content-Type', file_res.headers.get('Content-Type') || cargo.content_type)
  return stream(c, async stream => {
    stream.onAbort(() => {  })
    if(file_res.body){
      await stream.pipe(file_res.body)
    } else {
      stream.abort()
    }
  })
})

jetsam.get('/cargo/:id/partial', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const range_header = c.req.header('Range')

  if(!range_header){ throw new HTTPException(404, { message: 'No byte range supplied' }) }
  if(/^bytes=\d+-\d+$/.test(range_header) === false){ throw new HTTPException(404, { message: 'Range is badly formatted' }) }

  const start: number = +range_header.split('=')[1].split('-')[0]
  const end: number = +range_header.split('=')[1].split('-')[1]

  const cargo = (await db.query<Array<Cargo[]>>(surql`SELECT * FROM cargo WHERE canal = ${new RecordId('canal', user.id)} AND id = ${new RecordId('cargo', id)} LIMIT 1;`).catch((_err) => {
    throw new HTTPException(400, { message: 'Could not fetch the cargo' })
  }))[0][0]
  if(!cargo){ throw new HTTPException(404, { message: 'Cargo not found' }) }

  if(cargo.downloads_total - cargo.downloads_count < 1 && start === 0){ throw new HTTPException(404, { message: 'This cargo has run out of downloads' }) }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const file_res = await fetch(`${endpoint}/b2api/v4/b2_download_file_by_id?fileId=${cargo.b2_file_id}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken,
      'Range': `bytes=${start}-${end}`
    }
  })
  if(!file_res.ok){
    const error = await file_res.json()
    throw new HTTPException(404, { message:  error.message })
  }

  if(start === 0){
    const cargo_updated = (await db.query<Array<Cargo[]>>(surql`
      UPDATE type::record(${cargo.id.toString()}, 'cargo') SET downloads_count += ${1};
    `).catch((_err) => {
      throw new HTTPException(400, { message: 'Could not fetch the cargo' })
    }))[0][0]
    if(!cargo_updated){ throw new HTTPException(404, { message: 'Cargo download count could not be updated' }) }
  }

  c.header('Content-Disposition', 'attachment')
  c.header('Content-Type', file_res.headers.get('Content-Type') || cargo.content_type)
  c.header('Content-Range', file_res.headers.get('Content-Range') || `bytes ${start}-${end}/${cargo.size}`)
  return stream(c, async stream => {
    stream.onAbort(() => {  })
    if(file_res.body){
      await stream.pipe(file_res.body)
    } else {
      stream.abort()
    }
  })
})

jetsam.patch('/cargo/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const schema = z.string({ message: 'Provide the name' })
  const body = await c.req.json()
  const validation = schema.safeParse(body.name)

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const cargo = (await db.query<Array<UploadSession[]>>(surql`
    UPDATE cargo SET name = ${validation.data} WHERE id = ${new RecordId('upload_session', id)} AND canal = ${new RecordId('canal', user.id)};
  `).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not update cargo' })
  }))[0][0]

  if(!cargo){ throw new HTTPException(404, { message: 'Cargo not found' }) }

  return c.json(cargo)
})

jetsam.delete('/cargo/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')

  const cargo = (await db.query<Array<Cargo[]>>(surql`
    SELECT * FROM cargo WHERE id = ${new RecordId('cargo', id)} AND canal = ${new RecordId('canal', user.id)};
  `))[0][0]

  if(!cargo){ throw new HTTPException(404, { message:  'Cargo is not found' }) }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const delete_file_res = await fetch(endpoint+'/b2api/v4/b2_delete_file_version', {
    method: 'POST',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    },
    body: JSON.stringify({
      fileName: cargo.original_filename,
      fileId: cargo.b2_file_id
    })
  })
  const delete_file = await delete_file_res.json()
  if(!delete_file_res.ok){throw new HTTPException(404, { message:  delete_file.message })}

  await db.delete(cargo.id)

  return c.json({ status: 'success' })
})

jetsam.post('/cost', verifyRequest(['sailor']), c => {
  const size = c.req.query('size')
  const downloads = c.req.query('downloads') ? Number(c.req.query('downloads')) : 3
  const retention = c.req.query('retention') ? Number(c.req.query('retention')) : 1

  if(!size){ throw new HTTPException(404, { message: 'File size must be proived' }) }

  if(typeof Number(size) !== 'number'){ throw new HTTPException(404, { message: 'File size must be a number' }) }

  return c.json(new Billing().calculateSubpointForCargo(+size, downloads, retention))
})

jetsam.post('/large/start', verifyRequest(['sailor']), async c => {

  if(!endpoint){ throw new HTTPException(400, { message: 'The object storage endpoint was not found' }) }
  const user = c.get('user')

  const schema = z.object({
    type: z.string({ message: 'Provide the content type of the cargo' }),
    name: z.string({ message: 'Provide the cargo name' }),
    size: z.number({ message: 'Provide the cargo size', coerce: true }).min(9 * (1024 ** 2), 'Large cargo size must be at least 1 byte').max(40 * (1024 ** 3), 'Large cargo cannot be bigger than 40GB in size'),
    downloads: z.number({ message: 'Provide the desired number of downloads', coerce: true }).min(3, 'Every cargo is required to have at 3 downloads'),
    retention: z.number({ message: 'Provide the desired number of retention months', coerce: true }).min(1, 'Every cargo must have at least 1 months of retention').max(36, 'Cargo storage cannot be paid 36 months into the future'),
    chunks: z.number({ message: 'Provide the total number of cargo chunks', coerce: true }).min(2, 'There must be at least 2 chunks').max(10000, 'There cannot be more than 10 000 chunks')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
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
    if(formatted.type){ formatted.type._errors.forEach(val => message.push(val)) }
    if(formatted.name){ formatted.name?._errors.forEach(val => message.push(val)) }
    if(formatted.size){ formatted.size?._errors.forEach(val => message.push(val)) }
    if(formatted.downloads){ formatted.downloads?._errors.forEach(val => message.push(val)) }
    if(formatted.retention){ formatted.retention?._errors.forEach(val => message.push(val)) }
    if(formatted.chunks){ formatted.chunks?._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const { name, type, size, downloads, retention, chunks } = validation.data

  const costs = new Billing().calculateSubpointForCargo(size, downloads, retention)
  const canal = await db.select<Canal>(new RecordId('canal', user.id))
  if(canal.is_premium === false){ throw new HTTPException(403, { message: 'You need a premium canal to use this feature' }) }
  if( costs.total_subpoints > (canal.capacity - canal.usage) ){ throw new HTTPException(400, { message: 'You have insufficient drops for this action' }) }

  const sanitisation = await sanitizeFilename(name)
  const file_storage_name = `${canal.letter_sequence.replace(/[^A-Z]/g, '')}/${sanitisation.storage_name}`

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(400, { message:  storage_account_auth.message })}

  const start_file_res = await fetch(endpoint+'/b2api/v4/b2_start_large_file', {
    method: 'POST',
    headers: { 'Authorization': storage_account_auth.authorizationToken },
    body: JSON.stringify({
      fileName: file_storage_name,
      contentType: 'application/octet-stream',
      bucketId: bucket
    })
  })
  const start_file = await start_file_res.json()
  if(!start_file_res.ok){ throw new HTTPException(400, { message: start_file.message }) }

  const file_id = start_file.fileId

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_part_url?fileId=${file_id}`, {
    method: 'GET',
    headers: { 'Authorization': storage_account_auth.authorizationToken }
  })

  const upload_url = await upload_url_res.json()

  if(!upload_url_res.ok){ throw new HTTPException(400, { message: 'Could not fetch upload URLs' }) }

  const cargo_content = {
    canal: canal.id, 
    b2_file_id: file_id,
    subpoints: costs.total_subpoints,
    downloads_count: 0,
    downloads_total: downloads,
    name: sanitisation.display_name,
    original_filename: file_storage_name,
    content_type: type,
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

  const information: Information = {
    id: cargo.id.id.toString(),
    file_id: file_id,
    session_id: session.id.id.toString(),
    url: upload_url.uploadUrl,
    token: upload_url.authorizationToken,
    multipart: true,
    name: file_storage_name,
    size: cargo.size,
    type: cargo.content_type
  }

  await db.query(surql`UPDATE type::record(${canal.id.toString()}, 'canal') SET usage += ${costs.total_subpoints};`).catch((_err) => {
    throw new HTTPException(400, { message: 'Error updating usage' })
  })

  return c.json(information)
})

jetsam.patch('/large/session/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const schema = z.object({
    sha1: z.string({ message: 'Provide the sha1 hash of the chunk' }),
    size: z.number({ message: 'Provide the chunk size', coerce: true }).min(1, 'Chunk size must be at least 1 byte'),
    index: z.number({ message: 'Provide index number of this chunk', coerce: true }).min(1, 'A chunk index cannot be smaller than 1').max(10000, 'A chunk index cannot be bigger than 10 000')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
    sha1: body.sha1,
    size: body.size,
    index: body.index
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.sha1){ formatted.sha1._errors.forEach(val => message.push(val)) }
    if(formatted.size){ formatted.size?._errors.forEach(val => message.push(val)) }
    if(formatted.index){ formatted.index?._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const session = (await db.query<Array<UploadSession[]>>(surql`
    UPDATE upload_session SET uploaded_chunks += ${validation.data} WHERE id = ${new RecordId('upload_session', id)} AND cargo.canal = ${new RecordId('canal', user.id)};
  `).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not update upload session' })
  }))[0][0]

  if(!session){ throw new HTTPException(404, { message: 'This upload session was not found' }) }

  return c.json({
    percentage_completion: Math.floor( ( session.uploaded_chunks.length / session.total_chunks ) * 100 )
  })
})

jetsam.delete('/large/session/:id', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')

  const session = (await db.query<Array<UploadSession[]>>(surql`
    SELECT * FROM upload_session WHERE id = ${new RecordId('upload_session', id)} AND cargo.canal = ${new RecordId('canal', user.id)};
  `).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not update upload session' })
  }))[0][0]
  if(!session){ throw new HTTPException(404, { message: 'This upload session was not found' }) }

  const cargo = await db.select<Cargo>(session.cargo)

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const cancel_file_res = await fetch(endpoint+'/b2api/v4/b2_cancel_large_file', {
    method: 'POST',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    },
    body: JSON.stringify({ fileId: cargo.b2_file_id })
  })
  const cancel_file = await cancel_file_res.json()
  if(!cancel_file_res.ok){throw new HTTPException(404, { message:  cancel_file.message })}

  await db.delete(session.id)
  await db.delete(cargo.id)

  return c.json({status: 'success'})
})

jetsam.get('/large/session/:id/url', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')

  const session = (await db.query<Array<UploadSession[]>>(surql`
    SELECT * FROM upload_session WHERE id = ${new RecordId('upload_session', id)} AND cargo.canal = ${new RecordId('canal', user.id)};
  `).catch((_err) => {
    throw new HTTPException(404, { message: 'Could not update upload session' })
  }))[0][0]
  if(!session){ throw new HTTPException(404, { message: 'This upload session was not found' }) }

  const cargo = await db.select<Cargo>(session.cargo)

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_part_url?fileId=${cargo.b2_file_id}`, {
    method: 'GET',
    headers: { 'Authorization': storage_account_auth.authorizationToken }
  })

  const upload_url = await upload_url_res.json()

  if(!upload_url_res.ok){ throw new HTTPException(400, { message: 'Could not fetch upload URLs' }) }

  const information: Information = {
    id: cargo.id.id.toString(),
    file_id: cargo.b2_file_id,
    session_id: session.id.id.toString(),
    url: upload_url.url,
    token: upload_url.authorizationToken,
    multipart: true,
    name: cargo.original_filename,
    sha1: cargo.sha1,
    size: cargo.size,
    type: cargo.content_type,
  }

  return c.json(information)
})

jetsam.post('/large/finish', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const schema = z.object({
    file_id: z.string({ message: 'Provide the file id' }),
    session_id: z.string({ message: 'Provide the session id'}),
    hashes: z.string({ message: 'Provide the SHA1 hashes of the chunks' }).array().min(2, 'Must at least have 2 chunk hashes').max(10000, 'Cannot have more than 10 000 chunk hashes')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
    file_id: body.file_id,
    session_id: body.session_id,
    hashes: body.hashes
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.file_id){ formatted.file_id._errors.forEach(val => message.push(val)) }
    if(formatted.session_id){ formatted.session_id?._errors.forEach(val => message.push(val)) }
    if(formatted.hashes){ formatted.hashes?._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const { file_id, session_id, hashes } = validation.data

  const session = (await db.query<Array<UploadSession[]>>(surql`
    SELECT * FROM upload_session WHERE id = ${new RecordId('upload_session', session_id)} AND cargo.canal = ${new RecordId('canal', user.id)};
  `))[0][0]

  if(!session){ throw new HTTPException(400, { message: 'File upload session was not found' }) }
  if(session.total_chunks !== session.uploaded_chunks.length){ throw new HTTPException(400, { message: 'The file upload is not complete' }) }
  if(session.total_chunks !== hashes.length){ throw new HTTPException(400, { message: 'The provided hashes are either small or larger than expected' }) }
  const stored_hashes = session.uploaded_chunks.map(chunk => chunk.sha1)
  if(!equal(hashes, stored_hashes)){ throw new HTTPException(400, { message: 'The provided hash does not match' }) }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const finish_file_res = await fetch(endpoint+'/b2api/v4/b2_finish_large_file', {
    method: 'POST',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    },
    body: JSON.stringify({
      fileId: file_id,
      partSha1Array: hashes
    })
  })
  const finish_file = await finish_file_res.json()
  if(!finish_file_res.ok){throw new HTTPException(404, { message:  finish_file.message })}
  
  const cargo = (await db.query<Array<Cargo[]>>(surql`UPDATE type::record(${session.cargo.toString()}, 'cargo') SET is_complete = ${true};`))[0][0]

  return c.json(cargo)
})

jetsam.post('/small/start', verifyRequest(['sailor']), async c => {
  const user = c.get('user')

  const schema = z.object({
    sha1: z.string({ message: 'Provide a SHA1 hash of the cargo' }),
    type: z.string({ message: 'Provide the content type of the cargo' }),
    name: z.string({ message: 'Provide the cargo name' }),
    size: z.number({ message: 'Provide the cargo size', coerce: true }).min(1, 'Small cargo size must be at least 1 byte').max(9*1024*2024, 'Cannot upload small cargo bigger than 9MB'),
    downloads: z.number({ message: 'Provide the desired number of downloads', coerce: true }).min(3, 'Every cargo is required to have at 3 downloads'),
    retention: z.number({ message: 'Provide the desired number of retention months', coerce: true }).min(1, 'Every cargo must have at least 1 months of retention').max(36, 'Cargo storage cannot be paid 36 months into the future')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
    sha1: body.sha1, 
    type: body.type, 
    name: body.name,
    size: body.size,
    downloads: body.downloads,
    retention: body.retention
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
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const { sha1, name, type, size, downloads, retention } = validation.data

  const costs = new Billing().calculateSubpointForCargo(size, downloads, retention)
  const canal = await db.select<Canal>(new RecordId('canal', user.id))
  if(canal.is_premium === false){ throw new HTTPException(403, { message: 'You need a premium canal to use this feature' }) }
  if( costs.total_subpoints > (canal.capacity - canal.usage) ){ throw new HTTPException(400, { message: 'You have insufficient drops for this action' }) }

  const sanitisation = await sanitizeFilename(name)
  const file_storage_name = `${canal.letter_sequence.replace(/[^A-Z]/g, '')}/${sanitisation.storage_name}`

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(400, { message:  storage_account_auth.message })}

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_url?bucketId=${bucket}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  const upload_url = await upload_url_res.json()
  if(!upload_url_res.ok){throw new HTTPException(404, { message:  upload_url.message })}

  const cargo_content: Partial<Cargo> = {
    canal: canal.id,
    subpoints: costs.total_subpoints,
    downloads_count: 0,
    downloads_total: downloads,
    name: sanitisation.display_name,
    original_filename: file_storage_name,
    content_type: type,
    sha1: sha1,
    size: size,
    is_complete: false,
    is_independent: true,
    is_public: false,
    storage_valid_until: new Date( Date.now() + ( 1000*60*60*24*30*retention ) )
  }

  const cargo = (await db.query<Array<Cargo>>(surql`CREATE ONLY cargo CONTENT ${cargo_content};`))[0]

  await db.query(surql`UPDATE type::record(${canal.id.toString()}, 'canal') SET usage += ${costs.total_subpoints};`).catch((_err) => {
    throw new HTTPException(400, { message: 'Error updating usage' })
  })

  const information: Information = {
    id: cargo.id.id.toString(),
    url: upload_url.uploadUrl,
    token: upload_url.authorizationToken,
    name: file_storage_name,
    sha1: cargo.sha1,
    size: cargo.size,
    type: cargo.content_type,
    multipart: false
  }

  return c.json(information)
})

jetsam.post('/small/finish', verifyRequest(['sailor']), async c => {
  const user = c.get('user')
  const cargo_id = c.req.query('cargo')

  if(!cargo_id){ throw new HTTPException(400, { message: 'Provide the cargo id' }) }

  const schema = z.object({
    file_id: z.string({ message: 'Provide the cargo file id' })
  })

  const body = await c.req.json()
  const validation = schema.safeParse({ file_id: body.file_id })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.file_id){ formatted.file_id._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_file_info?fileId=${validation.data.file_id}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  const upload_url = await upload_url_res.json()
  if(!upload_url_res.ok){throw new HTTPException(404, { message:  upload_url.message })}

  const cargo = (await db.query<Array<Cargo>>(surql`
    UPDATE ONLY cargo SET is_complete = ${true}, b2_file_id = ${validation.data.file_id} WHERE id = ${new RecordId('cargo', cargo_id)} AND canal = ${new RecordId('canal', user.id)} AND is_complete = ${false};
  `))[0]
  if(!cargo){ throw new HTTPException(404, { message:  'Cargo not found' }) }

  return c.json({id: cargo.id.id.toString()})
})

jetsam.get('/connection/:id', verifyRequest(['sailor', 'seafarer']), async c => {
  const user = c.get('user')
  const connection_id = c.req.param('id')
  const cargo_id = c.req.query('cargo')

  if(!cargo_id){ throw new HTTPException(400, { message: 'Provide the cargo id' }) }

  let query: PreparedQuery
  switch(user.table){
    case 'canal':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', connection_id)} AND out.canal = ${new RecordId('canal', user.id)};`
      break;
    case 'wave':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', connection_id)} AND in = ${new RecordId('wave', user.id)};`
      break;
  }

  const is_connected = (await db.query<Array<ConnectsWith[]>>(query))[0][0]
  if(!is_connected){ throw new HTTPException(403, { message: 'Connection not found' }) }

  const [cargo, opened] = await db.query<[Cargo, number]>(surql`
    SELECT * FROM ONLY cargo WHERE id = ${new RecordId('cargo', cargo_id)} AND bridge = ${is_connected.out} LIMIT 1;
    RETURN count(SELECT * FROM opened_by WHERE in = ${new RecordId('cargo', cargo_id)} AND out = ${new RecordId(user.table, user.id)});
  `)
  if(!cargo){ throw new HTTPException(400, { message: 'Cargo not found' }) }
  if(opened > 0){ throw new HTTPException(400, { message: 'You have already opened this image' }) }
  if(cargo.downloads_count >= cargo.downloads_total){ throw new HTTPException(400, { message: 'You have reached the maximum downloads on this cargo' }) }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const file_res = await fetch(`${endpoint}/b2api/v4/b2_download_file_by_id?fileId=${cargo.b2_file_id}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  if(!file_res.ok){
    const error = await file_res.json()
    throw new HTTPException(404, { message:  error.message })
  }
  await db.query(surql`RELATE ${cargo.id}->opened_by->${new RecordId(user.table, user.id)};`)

  c.header('Content-Disposition', 'inline')
  c.header('Content-Type', file_res.headers.get('Content-Type') || cargo.content_type)
  return stream(c, async stream => {
    stream.onAbort(() => {  })
    if(file_res.body){
      await stream.pipe(file_res.body)
    } else {
      stream.abort()
    }
  })
})

jetsam.post('/connection/:id', verifyRequest(['sailor', 'seafarer']), async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  const storage_limit = ( 20 * (1024 ** 2) )

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
  if(!is_connected){ throw new HTTPException(403, { message: 'Connection not found' }) }

  const [canal, total_storage, bridge] = (await db.query<[Canal, number, Bridge]>(
    surql`
      SELECT VALUE canal.* FROM ONLY bridge WHERE id = ${is_connected.out} LIMIT 1;
      RETURN math::sum(SELECT VALUE size FROM cargo WHERE bridge = ${is_connected.out});
      SELECT * FROM ONLY bridge WHERE id = ${is_connected.out} LIMIT 1;
    `
  ))

  if(bridge.start_time > new Date()){ throw new HTTPException(403, { message: 'The connection is not active yet' }) }
  if(bridge.end_time < new Date()){ throw new HTTPException(403, { message: 'The connection is not longer active' }) }

  if(!canal.is_premium && total_storage >= storage_limit){ throw new HTTPException(400, { message: 'You have reached your free storage limit' }) }

  const schema = z.object({
    sha1: z.string({ message: 'Provide a SHA1 hash of the cargo' }),
    type: z.string({ message: 'Provide the content type of the cargo' }),
    name: z.string({ message: 'Provide the cargo name' }),
    size: z.number({ message: 'Provide the cargo size', coerce: true }).min(1, 'Cargo size must be at least 1 byte').max(5*1024*2024, 'Cannot upload cargo bigger than 5MB')
  })

  const body = await c.req.json()
  const validation = schema.safeParse({
    sha1: body.sha1, 
    type: body.type, 
    name: body.name,
    size: body.size
  })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.sha1){ formatted.sha1._errors.forEach(val => message.push(val)) }
    if(formatted.type){ formatted.type._errors.forEach(val => message.push(val)) }
    if(formatted.name){ formatted.name?._errors.forEach(val => message.push(val)) }
    if(formatted.size){ formatted.size?._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_upload_url?bucketId=${bucket}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  const upload_url = await upload_url_res.json()
  if(!upload_url_res.ok){throw new HTTPException(404, { message:  upload_url.message })}

  const { name, sha1, type, size } = validation.data
  const sanitisation = await sanitizeFilename(name)
  const file_storage_name = `${canal.letter_sequence.replace(/[^A-Z]/g, '')}/${sanitisation.storage_name}`

  const cargo_content: Partial<Cargo> = {
    canal: canal.id, 
    bridge: is_connected.out,
    subpoints: 0,
    downloads_count: 0,
    downloads_total: 2,
    name: sanitisation.display_name,
    original_filename: file_storage_name,
    content_type: type,
    sha1: sha1,
    size: size,
    is_complete: false,
    is_independent: false,
    is_public: false,
    storage_valid_until: bridge.end_time
  }

  const cargo = (await db.query<Array<Cargo>>(surql`CREATE ONLY cargo CONTENT ${cargo_content};`))[0]

  return c.json({
    id: cargo.id.id.toString(),
    url: upload_url.uploadUrl,
    token: upload_url.authorizationToken,
    name: file_storage_name,
    sha1: cargo.sha1,
    size: cargo.size,
    type: cargo.content_type
  })
})

jetsam.patch('/connection/:id', verifyRequest(['sailor', 'seafarer']), async c => {
  const user = c.get('user')
  const connection_id = c.req.param('id')
  const cargo_id = c.req.query('cargo')

  if(!cargo_id){ throw new HTTPException(400, { message: 'Provide the cargo id' }) }

  let query: PreparedQuery
  switch(user.table){
    case 'canal':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', connection_id)} AND out.canal = ${new RecordId('canal', user.id)};`
      break;
    case 'wave':
      query = surql`SELECT * FROM connects_with WHERE id = ${new RecordId('connects_with', connection_id)} AND in = ${new RecordId('wave', user.id)};`
      break;
  }

  const is_connected = (await db.query<Array<ConnectsWith[]>>(query))[0][0]
  if(!is_connected){ throw new HTTPException(403, { message: 'Connection not found' }) }

  const schema = z.object({
    file_id: z.string({ message: 'Provide the cargo file id' })
  })

  const body = await c.req.json()
  const validation = schema.safeParse({ file_id: body.file_id })

  if(validation.success === false){ 
    const formatted = validation.error.format()
    const  message: string[] = []
    formatted._errors.forEach(val => message.push(val))
    if(formatted.file_id){ formatted.file_id._errors.forEach(val => message.push(val)) }
    throw new HTTPException(404, { message: message.join(' • ')  }) 
  }

  const storage_account_auth_res = await fetch(endpoint+'/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${keys()}`
    }
  })
  const storage_account_auth = await storage_account_auth_res.json()
  if(!storage_account_auth_res.ok){throw new HTTPException(404, { message:  storage_account_auth.message })}

  const upload_url_res = await fetch(`${endpoint}/b2api/v4/b2_get_file_info?fileId=${validation.data.file_id}`, {
    method: 'GET',
    headers: {
      'Authorization': storage_account_auth.authorizationToken
    }
  })
  const upload_url = await upload_url_res.json()
  if(!upload_url_res.ok){throw new HTTPException(404, { message:  upload_url.message })}

  const cargo = (await db.query<Array<Cargo>>(surql`UPDATE ONLY cargo SET is_complete = ${true}, b2_file_id = ${validation.data.file_id} WHERE id = ${new RecordId('cargo', cargo_id)} AND bridge = ${is_connected.out} AND is_complete = ${false};`))[0]
  if(!cargo){ throw new HTTPException(404, { message:  'Cargo not found' }) }

  return c.json({id: cargo.id.id.toString()})
})

export default jetsam