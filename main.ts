import { Hono } from '@hono/hono'
import { logger } from '@hono/hono/logger'
import { startUpDatabase } from "./database/config.ts"
import canal from "./canal/canal.routes.ts"

const app = new Hono()
startUpDatabase()

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

const port = Number(Deno.env.get('PORT')) ?? 6001
Deno.serve({port: port}, app.fetch)