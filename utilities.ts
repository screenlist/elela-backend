import { JWTPayload, jwtVerify } from '@panva/jose'
import { Context, Next } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { db } from "./database/config.ts";
import { RecordId, surql } from "@surrealdb/surrealdb";
import { ethers } from 'ethers'
import { encodeHex, decodeHex } from '@std/encoding'
import { CoinAPIResponse, Rate } from "./payments/payments.config.ts";
import { Session, Visit } from "./canal/canal.config.ts";

async function _sortHexColorsFromBlackToWhite(path: string){
  const colorstext = await Deno.readTextFile(path)
  const colorsarray: Array<string[]> = Object.entries(JSON.parse(colorstext))
  function sortHexColorsByBrightness(hexColors: Array<string[]>): Array<string[]> {
    return hexColors.slice().sort((a, b) => {
      const brightness = (hex: string): number => {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return r + g + b
      }
      return brightness(a[0]) - brightness(b[0])
    })
  }
  const colors: {[key: string]: string } = {}
  console.log(colorsarray)
  sortHexColorsByBrightness(colorsarray).forEach(val => { colors[val[1]] = val[0] })
  return colors
}

function hashWord(word: string) {
  let hash = 0
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i)
    hash |= 0 // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('KEY')
  const encoder = new TextEncoder()
  const data = encoder.encode(secret)
  return crypto.subtle.importKey(
    'raw',
    data,
    {
      name: 'HMAC',
      hash: {name: 'SHA-256'}
    },
    false,
    ['sign', 'verify']
  )
}

export function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer)
  return Array.from(byteArray).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export async function encodeHMAC(message: string){
  const key = await hmacKey()
  const encoder = new TextEncoder()
  const data =  encoder.encode(message)
  const signature = await crypto.subtle.sign('HMAC', key, data)
  return bufferToHex(signature)
}

export async function verifyHMAC(message: string, encoded_hmac: string) {
  const key = await hmacKey()
  const encoder = new TextEncoder()
  const data =  encoder.encode(message)
  const signature = hexToBytes(encoded_hmac)
  return await crypto.subtle.verify('HMAC', key, signature, data)
}

export async function diceware(length: number): Promise<string[]> {
  const wordstext = await Deno.readTextFile('./wordlist.json')
  const words = JSON.parse(wordstext)
  const set: string[] = []

  while(set.length < length){
    const charset = '123456'
    let dice = ''
    const randomValues = crypto.getRandomValues(new Uint8Array(length))
    for(let i = 0; i < 5; i++){
      dice += charset[randomValues[i]% charset.length] 
    }
    set.push(dice)
  }

  const phrase: string[] = set.map(value => {
    return words[value]
  })
  return phrase
}

export async function emojiware(length: number){
  const emojitext = await Deno.readTextFile('./emojilist.json')
  const emojiObject: {[key: string]: {
    name: string
    slug: string
    group: string
    emoji_version: string
    unicode_version: string
    skin_tone_support: boolean
  }} = JSON.parse(emojitext)
  const emojiArray = Object.entries(emojiObject).filter(item => {
    const version = +item[1].unicode_version
    return version < 8
  }).map(item => item[0])
  let emojis = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  for(let i = 0; i < length; i++){
    emojis += emojiArray[randomValues[i]% emojiArray.length] 
  }
  return emojis
}

export async function generateWordColorMap(){
  const wordstext = await Deno.readTextFile('./wordlist.json')
  const wordsObject: {[key: string]: string} = JSON.parse(wordstext)
  const colorstext = await Deno.readTextFile('./colorlist.json')
  const colorsObject: {[key: string]: string} = JSON.parse(colorstext)
  const words = Object.values(wordsObject)
  const colors = Object.values(colorsObject)
  
  const wordToColor: { [key: string]: string } = {}

  words.forEach(word => {
    const hash = hashWord(word)
    const color = colors[hash % colors.length]
    wordToColor[word] = color
  })

  return wordToColor
}

export async function reverseColorToWords(){
  const wordToColor = await generateWordColorMap()
  const colorToWords: {[key: string]: string[]} = {}
  for(const [word, color] of Object.entries(wordToColor)){
    if(!colorToWords[color]){
      colorToWords[color] = []
    }
    colorToWords[color].push(word)
  }
  return colorToWords
}

export class Billing {

  calculateUnitPrice(quantity: number){
    const base = 0.15
    const minimum = 0.09
    const decay = 0.02
    const difference = base - minimum
    const discount = difference * Math.exp(-decay * quantity)
    return minimum + discount
  }

  subpointsToFlowpoints(subpoints: number){
    return ( subpoints / 100 ).toFixed(2)
  }

  flowpointsToSubpoints(flowpoints: number){
    return flowpoints*100
  }

  calculateSubpointForCargo(
    fileSizeBytes: number,
    desiredDownloads: number,
    desiredRetentionMonths: number = 1
  ) {
    const bytesPerGB = 1024 ** 3;
    const storageCostPerGBPerMonth = 0.006; // USD
    const downloadCostPerGB = 0.01;         // USD
    const flowPointValueUSD = 0.03;          // USD per Flowpoint
  
    const subpointsPerFlowpoint = 100
  
    const fileSizeGB = fileSizeBytes / bytesPerGB;

    const storageCostUSD = fileSizeGB * storageCostPerGBPerMonth * desiredRetentionMonths;
    const downloadCostUSD = desiredDownloads <= 3 ? 0 : fileSizeGB * downloadCostPerGB * (desiredDownloads - 3);

    const storageSubpoints = Math.ceil((storageCostUSD / flowPointValueUSD) * subpointsPerFlowpoint);
    const downloadSubpoints = Math.ceil((downloadCostUSD / flowPointValueUSD) * subpointsPerFlowpoint);
    const totalSubpoints = storageSubpoints + downloadSubpoints
  
    return {
      storage_subpoints: storageSubpoints,
      downloads: desiredDownloads,
      retention: desiredRetentionMonths,
      download_subpoints: downloadSubpoints,
      total_subpoints: totalSubpoints,
    };
  }

  calculateSubpointForCalls(minutes: number){
    const flowPointValueUSD = 0.03
    const callCostPerMinuteUSD = 0.002

    const subpointsPerFlowpoint = 100

    const callCostUSD = minutes * callCostPerMinuteUSD
    const callSubpoints = Math.ceil( ( callCostUSD / flowPointValueUSD ) * subpointsPerFlowpoint )

    return {
      minutes: minutes,
      subpoints: callSubpoints
    }
  }

  calculateSubpointForBridge(minutes: number){
    const flowPointValueUSD = 0.03
    const bridgeCostPerMinuteUSD = 0.0005

    const subpointsPerFlowpoint = 100

    const bridgeCostUSD = minutes * bridgeCostPerMinuteUSD
    const bridgeSubpoints = Math.ceil( ( bridgeCostUSD / flowPointValueUSD ) * subpointsPerFlowpoint )

    return {
      minutes: minutes,
      subpoints: bridgeSubpoints
    }
  }

  calculateStorageFromSubpoints(subpoints: number){
    const storageCostPerGBPerMonth = 0.006
    const flowPointValueUSD = 0.03         
    const subpointsPerFlowpoint = 100

    const flowpoints = subpoints / subpointsPerFlowpoint
    const totalCost = flowpoints * flowPointValueUSD
    const storageGB = Math.round(totalCost / storageCostPerGBPerMonth)

    return {
      storage: storageGB,
      downloads: Math.round(storageGB * 3)
    }
  }

  calculateCallsFromSubpoints(subpoints: number){
    const flowPointValueUSD = 0.03
    const callCostPerMinuteUSD = 0.0015
    const subpointsPerFlowpoint = 100

    const flowpoints = subpoints / subpointsPerFlowpoint
    const totalCost = flowpoints * flowPointValueUSD
    const callMinutes = Math.round(totalCost / callCostPerMinuteUSD)

    return {
      minutes: callMinutes
    }
  }

  async convertToTender(amount: number, tender: 'avax' | 'zar') {
    const coinAPIUrl = Deno.env.get('COINAPI_URL')
    const coinAPIKey = Deno.env.get('COINAPI_KEY')
  
    if(!coinAPIKey || !coinAPIUrl){ throw new HTTPException(404, { message: 'Exchange rate cannot be queried' }) }
  
    if(tender === 'zar'){
      try {
        const rate = (await db.query<[Rate[]]>(surql`SELECT * FROM rate WHERE base = 'USD' AND quote = 'ZAR' LIMIT 1;`))[0][0]
        if(!rate){
  
          const fetchRate = await fetch(`${coinAPIUrl}/v1/exchangerate/usd/zar`, { headers: { 'X-CoinAPI-Key': coinAPIKey, 'Accept': 'text/plain' } })
          const latestRate: CoinAPIResponse = await fetchRate.json()
          if(!fetchRate.ok){ throw new HTTPException( 404, { message: 'Exchange rate cannot be queried', cause: latestRate } ) }
          const newRateContent = {
            base: 'USD',
            quote: 'ZAR',
            amount: latestRate.rate
          }
          await db.query(surql`CREATE rate CONTENT ${newRateContent};`)
          return latestRate.rate*amount
  
        } else if(rate && Date.now() - new Date(rate.updated_at).valueOf() > (1000*60*30)){
  
          const fetchRate = await fetch(`${coinAPIUrl}/v1/exchangerate/usd/zar`, { headers: { 'X-CoinAPI-Key': coinAPIKey, 'Accept': 'text/plain' } })
          const latestRate: CoinAPIResponse = await fetchRate.json()
          if(!fetchRate.ok){ throw new HTTPException( 404, { message: 'Exchange rate cannot be queried', cause: latestRate } ) }
          await db.query(surql`UPDATE type::record(${rate.id.toString()}) SET amount = ${latestRate.rate}, updated_at = ${new Date()};`)
          return latestRate.rate*amount
  
        } else {
          return rate.amount*amount
        }
      } catch (error) {
        throw new HTTPException(404, { message: `Could not convert to South African Rands`, cause: error})
      }
    } else if(tender === 'avax'){
      try {
        const rate = (await db.query<[Rate[]]>(surql`SELECT * FROM rate WHERE base = 'USD' AND quote = 'AVAX' LIMIT 1;`))[0][0]
        if(!rate){
  
          const fetchRate = await fetch(`${coinAPIUrl}/v1/exchangerate/usd/avax`, { headers: { 'X-CoinAPI-Key': coinAPIKey, 'Accept': 'text/plain' } })
          const latestRate: CoinAPIResponse = await fetchRate.json()
          if(!fetchRate.ok){ throw new HTTPException( 404, { message: 'Exchange rate cannot be queried', cause: latestRate } ) }
          const newRateContent = {
            base: 'USD',
            quote: 'AVAX',
            amount: latestRate.rate
          }
          await db.query(surql`CREATE rate CONTENT ${newRateContent};`)
          return latestRate.rate*amount
  
        } else if(rate && Date.now() - new Date(rate.updated_at).valueOf() > (1000*60*30)){
  
          const fetchRate = await fetch(`${coinAPIUrl}/v1/exchangerate/usd/avax`, { headers: { 'X-CoinAPI-Key': coinAPIKey, 'Accept': 'text/plain' } })
          const latestRate: CoinAPIResponse = await fetchRate.json()
          if(!fetchRate.ok){ throw new HTTPException( 404, { message: 'Exchange rate cannot be queried', cause: latestRate } ) }
          await db.query(surql`UPDATE type::record(${rate.id.toString()}) SET amount = ${latestRate.rate}, updated_at = ${new Date()};`)
          return latestRate.rate*amount
  
        } else {
          return rate.amount*amount
        }
      } catch (error) {
        throw new HTTPException(404, { message: `Could not convert to Avalanche`, cause: error})
      }
    } else { 
      throw new HTTPException(404, { message: 'Not enough parameters provided' })
    }
    
  }
  
  async findAVAXPayment(sender: string, reference: string) {
    const contractAddress = Deno.env.get('CONTRACT_ADDRESS')
    const rpcURL = Deno.env.get('AVAX_RPC')
  
    if(!contractAddress || !rpcURL){ throw new HTTPException(400, { message: 'Contract address or provider not provided' }) }
  
    const contractABI = ['event PaymentReceived ( address indexed sender, uint256 amount, string invoice )']
    const provider = new ethers.JsonRpcProvider(rpcURL)
    const contract = new ethers.Contract(contractAddress, contractABI, provider)
    const filter = contract.filters.PaymentReceived(sender)
    try {
      const events = await contract.queryFilter(filter, -1000)
      for (const event of events) {
        const key = event as ethers.EventLog
        const { args } = key;
        if (args && args.invoice === reference) {
          return {
            sender: args.sender,
            amount: ethers.formatEther(args.amount),
            reference: args.invoice,
            transactionHash: key.transactionHash
          };
        }
      }
  
      return null
    } catch (error) {
      throw new HTTPException(400, {message: 'Payment could not be verified', cause: error})
    }
  }

  readableMoney(price: number) {
    return parseFloat((price).toFixed(2)).toLocaleString('en-ZA', {style: 'currency', currency: 'ZAR'})
  }
}

export function verifyRequest(roles: Array<'sailor' | 'seafarer'>){
  return async (c: Context, next: Next) => {
    const unixTimestamp = Math.floor(Date.now()/1000)
    
    const bearer = c.req.header('Authorization')
    if(!bearer){ throw new HTTPException(401, {message: 'Access denied'}) }
    const jwt = bearer.split(' ')[1]
    const encoder = new TextEncoder()
    const jwtSecret = Deno.env.get('JWT_SECRET')
    const encodedSecret =  encoder.encode(jwtSecret)
    const decodedJwt = await jwtVerify(jwt, encodedSecret)
    const payload: JWTPayload & {role?: 'sailor' | 'seafarer', sid?: string} =  decodedJwt['payload']
    if(!payload.exp || !payload.iat || !payload.role){
      throw new HTTPException(401, { message: 'Access denied' })
    }
    if(unixTimestamp > payload.exp || payload.iat > unixTimestamp || roles.indexOf(payload.role) < 0){
      throw new HTTPException(401, { message: 'Access denied' })
    }

    if(payload.role === 'sailor'){
      if(!payload.sid){ throw new HTTPException(401, { message: 'Access denied' }) }
      const session = await db.select<Session>(new RecordId('session', payload.sid))
      if(Date.now() > new Date(session.expires_at).valueOf()){ throw new HTTPException(401, { message: 'Your session has expired' }) }
      const newExpiry = new Date( Date.now() + 1000*60*30 )
      await db.query(surql`UPDATE type::record(${session.id.toString()}) SET expires_at = ${newExpiry};`)
    }

    if(payload.role === 'seafarer'){
      if(!payload.sid){ throw new HTTPException(401, { message: 'Access denied' }) }
      const visit = await db.select<Visit>(new RecordId('visit', payload.sid))
      if(Date.now() > new Date(visit.expires_at).valueOf()){ throw new HTTPException(401, { message: 'Your session has expired' }) }
    }

    c.set('user', {
      id: payload.id,
      table: payload.role === 'sailor' ? 'canal' : payload.role === 'seafarer' ? 'wave' : undefined,
      session: payload.sid
    })
    await next()
  }
}

export async function generateUniquePassphrase(maxAttempts: number): Promise<string> {
  let attempts = 0

  while(attempts < maxAttempts){
    try {
      const canal = (await diceware(6)).join(' ')
      const canalHash = await encodeHMAC(canal)
      const matchingHashes = (await db.query<[number]>(surql`RETURN count(SELECT * FROM canal WHERE passphrase = ${canalHash});`))[0]
      if(matchingHashes === 0){
        return canal
      }
      attempts++
    } catch (error) {
      throw new HTTPException(400, { message: 'Could not generate canal passphrase', cause: error })
    }
  }
  
  throw new HTTPException(400, { message: `Failed to generate canal passphrase after ${attempts} attempts` })
}

export async function generateUniqueFlare(phrase: string, table: 'bridge' | 'wave' , maxAttempts: number): Promise<string> {
  let attempts = 0

  while(attempts < maxAttempts){
    try {
      const firstOneEmojis = await emojiware(1)
      const lastTwoEmojis = await emojiware(2)
      const flare = `${firstOneEmojis} ${phrase} ${lastTwoEmojis}`
      const bridgeQuery = surql`RETURN count(SELECT * FROM bridge WHERE public_code = ${flare});`
      const waveQuery = surql`RETURN count(SELECT * FROM wave WHERE public_code = ${flare});`

      if(table === 'bridge'){
        const [bridges] = await db.query<[number]>(bridgeQuery)
        if(bridges === 0){ return flare }
      }

      if(table === 'wave'){
        const [waves] = await db.query<[number]>(waveQuery)
        if(waves === 0){ return flare }
      }

      attempts++
    } catch (error) {
      throw new HTTPException(400, { message: 'Could not generate flare', cause: error })
    }
  }

  throw new HTTPException(400, { message: `Could not generate flare after ${attempts} attemps` })
}



export class Obfuscator {

  generateKey(length = 32){
    const randomBytes = crypto.getRandomValues(new Uint8Array(length))
    return encodeHex(randomBytes)
  }

  async deriveKey(salt: string, iterations = 10000){
    const masterKey = Deno.env.get('OTP_KEY')
    const encoder = new TextEncoder()

    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(masterKey),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    )

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations: iterations,
        hash: 'SHA-256'
      },
      material,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    )
  }

  async encrypt(data: string, key: CryptoKey){
    const encoder = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))

    const content =  await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(data)
    )

    const combined = new Uint8Array( [...iv, ...new Uint8Array(content)] )

    return encodeHex(combined)
  }

  async decrypt(data: string, key: CryptoKey){
    const decoder = new TextDecoder()
    const content = decodeHex(data) as Uint8Array<ArrayBuffer>
    const iv = content.subarray(0, 12)
    const slice = content.subarray(12)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      slice
    )

    return decoder.decode(decrypted)
  }
}