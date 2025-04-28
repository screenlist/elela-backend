import { JWTPayload, jwtVerify } from '@panva/jose'
import { Context, Next } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { getSurreal } from "./database/config.ts";
import { surql } from "@surrealdb/surrealdb";
import { ethers } from 'ethers'
import { CoinAPIResponse, Rate } from "./payments/payments.config.ts";

const db = await getSurreal()

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
    return version <= 10
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

export function readableMoney(price: number) {
  return parseFloat((price).toFixed(2)).toLocaleString('en-ZA', {style: 'currency', currency: 'ZAR'})
}

export function calculateUnitPrice(quantity: number){
  const base = 0.15
  const minimum = 0.09
  const decay = 0.02
  const difference = base - minimum
  const discount = difference * Math.exp(-decay * quantity)
  return minimum + discount
}

export function calculateUsagePoints(size: number, downloads: number){
  const storagePerPoint = 5*(1024*1000)
  const freeEgressMultiplier = 3
  const egressPerByte = storagePerPoint * freeEgressMultiplier
  const totalEgreePerByte = size * downloads
  return Math.ceil(totalEgreePerByte/egressPerByte)
}

export function calculateJetsamCost(fileSizeBytes: number, desiredDownloads: number, retention = 1) {
  const bytesPerGB = 1024 ** 3;
  const storageCostPerGB = 0.006; // USD
  const flowPointValueUSD = 0.03;
  const egressCostPerGB = 0.01;
  const egressPerFlowPointBytes = (flowPointValueUSD / egressCostPerGB) * bytesPerGB; // 3GB per flow point

  const fileSizeGB = fileSizeBytes / bytesPerGB;
  const storageCostUSD = fileSizeGB * storageCostPerGB;
  const storageFlowPoints = Math.ceil(storageCostUSD / flowPointValueUSD);
  
  const remainingBudgetUSD = flowPointValueUSD - storageCostUSD;
  const remainingEgressBytes = remainingBudgetUSD > 0
    ? (remainingBudgetUSD / egressCostPerGB) * bytesPerGB
    : 0;

  const freeEgressBytes = fileSizeBytes * 3;
  const maxFreeEgressBytes = freeEgressBytes + remainingEgressBytes;
  const maxDownloadsBeforeExtraPoints = Math.floor(maxFreeEgressBytes / fileSizeBytes);

  const includedDownloads = Math.max(3, maxDownloadsBeforeExtraPoints);
  const extraDownloads = Math.max(0, desiredDownloads - includedDownloads);

  const billableEgressBytes = fileSizeBytes * extraDownloads;
  const extraFlowPoints = Math.ceil(billableEgressBytes / egressPerFlowPointBytes);

  const totalFlowPoints = ( Math.round(retention)*storageFlowPoints ) + extraFlowPoints;

  return {
    strorage_points: storageFlowPoints*Math.round(retention),
    downloads_per_point: includedDownloads,
    extra_downloads: extraDownloads,
    extra_download_points: extraFlowPoints,
    retention_months: retention,
    total_points: totalFlowPoints
  };
}

function calculateJetsam(
  fileSizeBytes: number,
  desiredDownloads: number,
  desiredRetentionMonths: number = 1
) {
  const bytesPerGB = 1024 ** 3;
  const storageCostPerGBPerMonth = 0.006; // USD
  const downloadCostPerGB = 0.01;         // USD
  const flowPointValueUSD = 0.03;          // USD per Flowpoint

  const fileSizeGB = fileSizeBytes / bytesPerGB;

  // Storage Costs
  const storageCostUSD = fileSizeGB * storageCostPerGBPerMonth * desiredRetentionMonths;

  // Download Costs
  const downloadCostUSD = desiredDownloads <= 3 ? 0 : fileSizeGB * downloadCostPerGB * (desiredDownloads - 3);

  // Total Costs
  const totalCostUSD = storageCostUSD + downloadCostUSD;

  const totalFlowPoints = Math.ceil(totalCostUSD / flowPointValueUSD);

  // Split back how many flowpoints are due to storage and downloads separately
  const storageFlowPoints = Math.ceil(storageCostUSD / flowPointValueUSD);
  const downloadFlowPoints = Math.ceil(downloadCostUSD / flowPointValueUSD);

  const remainingFlowPointValueUSD = (totalFlowPoints * flowPointValueUSD) - totalCostUSD
  const maxRemainingDownloads = remainingFlowPointValueUSD > 0 ? Math.floor(remainingFlowPointValueUSD / (fileSizeGB * downloadCostPerGB)) : 0
  const maxRemainingRetention = remainingFlowPointValueUSD > 0 ? Math.floor(remainingFlowPointValueUSD / (fileSizeGB * storageCostPerGBPerMonth)) : 0

  return {
    storage_points: storageFlowPoints,
    downloads: desiredDownloads,
    retention: desiredRetentionMonths,
    download_points: downloadFlowPoints,
    remaining_value: {
      usage: Math.round( (totalCostUSD / (totalFlowPoints * flowPointValueUSD)) * 100 ),
      max_downloads: maxRemainingDownloads,
      max_retention: maxRemainingRetention
    },
    total_points: totalFlowPoints,
  };
}


console.log(calculateJetsam(5*1024*1024, 547, 116))
console.log(calculateJetsamCost(5*1024*1024, 120, 24))

export function verifyRequest(roles: Array<'sailor' | 'seafarer'>){
  return async (c: Context, next: Next) => {
    const unixTimestamp = Math.floor(Date.now()/1000)
    try {
      const bearer = c.req.header('Authorization')
      if(!bearer){ throw new HTTPException(401, {message: 'Access denied'}) }
      const jwt = bearer.split(' ')[1]
      const encoder = new TextEncoder()
      const jwtSecret = Deno.env.get('JWT_SECRET')
      const encodedSecret =  encoder.encode(jwtSecret)
      const decodedJwt = await jwtVerify(jwt, encodedSecret)
      const payload: JWTPayload & {role?: 'sailor' | 'seafarer'} =  decodedJwt['payload']
      if(!payload.exp || !payload.iat || !payload.role){
        throw new HTTPException(401, { message: 'Access denied' })
      }
      if(unixTimestamp > payload.exp || payload.iat > unixTimestamp || roles.indexOf(payload.role) < 0){
        throw new HTTPException(401, { message: 'Access denied' })
      }

      c.set('user', {
        id: payload.id,
        table: payload.role === 'sailor' ? 'canal' : payload.role === 'seafarer' ? 'wave' : undefined
      })
      await next()
    } catch (error) {
      throw new HTTPException(401, { message: 'Access denied', cause: error })
    }
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

export async function convertToTender(amount: number, tender: 'avax' | 'zar') {
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

export async function findAVAXPayment(sender: string, reference: string) {
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

console.log(ethers.parseEther('0.0717'))