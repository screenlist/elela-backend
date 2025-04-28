import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { startUpDatabase } from "./database/config.ts"
import canal from "./canal/canal.routes.ts"
import payments from "./payments/payments.routes.ts"
import jetsam from "./jetsam/jetsam.routes.ts"
import { HTTPException } from "@hono/hono/http-exception";

const app = new Hono()
startUpDatabase()

app.use(logger())
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