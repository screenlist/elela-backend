import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { cors } from '@hono/hono/cors'
import { startUpDatabase } from "./database/config.ts"
import canal from "./canal/canal.routes.ts"
import payments from "./payments/payments.routes.ts"
import jetsam from "./jetsam/jetsam.routes.ts"
import { HTTPException } from "@hono/hono/http-exception"
import { clean2faSetups } from './tasks.ts'

const app = new Hono()
startUpDatabase()

const client = Deno.env.get('CLIENT_HOST')
if(!client){ throw new Error('Provide a client host string') }

clean2faSetups.start()

app.use(logger())
app.use(cors(
  {
    origin: client
  }
))
app.onError((error, c) => {
  if(error instanceof HTTPException){
    return error.getResponse()
  }
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return c.text(message, 500)
})
app.get('/', c => c.text('Welcome to the world of spies'))
app.route('/canal', canal)
app.route('/payments', payments)
app.route('/jetsam', jetsam)

const port = Number(Deno.env.get('PORT')) ?? 6001
Deno.serve({port: port}, app.fetch)