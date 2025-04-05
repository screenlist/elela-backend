import { Hono } from '@hono/hono'
import { surql } from "@surrealdb/surrealdb"
import { getSurreal } from "../database/config.ts"
import { diceware, emojiware, encodeHMAC, verifyHMAC } from "../utilities.ts"

const db = await getSurreal()
const canal = new Hono()

canal.get('/canal/generate', async (c) => {
  const body = await c.req.json()
  const canal = await diceware(6)
  const canalHash = await encodeHMAC(name)
  const query = surql`
    CREATE account CONTENT {

    };
  `
  return c.json(canal)
})

export default canal