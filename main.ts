import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { startUpDatabase } from "./database/config.ts"
import canal from "./canal/canal.routes.ts"
import payments from "./payments/payments.routes.ts"

const app = new Hono()
startUpDatabase()

app.use(logger())
app.get('/', c => c.text('Welcome to the world of spies'))
app.route('/canal', canal)
app.route('/payments', payments)

const port = Number(Deno.env.get('PORT')) ?? 6001
Deno.serve({port: port}, app.fetch)