import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { startUpDatabase } from "./database/config.ts"
import { calculateJetsamCost } from './utilities.ts'
import canal from "./canal/canal.routes.ts"
import payments from "./payments/payments.routes.ts"

const app = new Hono()
startUpDatabase()
const bytes = 1024*1024*1024*1024
console.log(calculateJetsamCost(bytes, 1))
// const wordstext = await Deno.readTextFile('wordlist.txt')
// const wordsarray = wordstext.split('\n')
// const words: { [key: string]: object } = {}
// wordsarray.forEach((word) => {
//   const key = word.split('\t')[0]
//   const value = word.split('\t')[1]
//   words[key] = {
//     "original_word": value,
//     "mirror_word": "",
//     "relationship": ""
//   }
// })
// await Deno.writeTextFile('./spoilerlistb.json', JSON.stringify(words, null, 2)) 
app.use(logger())
app.get('/', c => c.text('Welcome to the world of spies'))
app.route('/', canal)
app.route('/payments', payments)

const port = Number(Deno.env.get('PORT')) ?? 6001
Deno.serve({port: port}, app.fetch)