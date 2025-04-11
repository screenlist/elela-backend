import { JWTPayload, jwtVerify } from '@panva/jose'
import { Context, Next } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";

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
    return words[value]['original_word']
  })
  return phrase
}

export async function emojiware(length: number){
  const emojitext = await Deno.readTextFile('./wordlist.json')
  const emojiObject = JSON.parse(emojitext)
  const emojiArray = Object.entries(emojiObject).map(item => item[0])
  let emojis = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  for(let i = 0; i < length; i++){
    emojis += emojiArray[randomValues[i]% emojiArray.length] 
  }
  return emojis
}

export function readableMoney(price: number) {
  return parseFloat((price).toFixed(2)).toLocaleString('en-ZA', {style: 'currency', currency: 'ZAR'})
}

export function calculateUnitPrice(quantity: number){
  const base = 3
  const minimum = 1.8
  const decay = 0.2
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

export function calculateJetsamCost(fileSizeBytes: number, desiredDownloads: number) {
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

  const totalFlowPoints = storageFlowPoints + extraFlowPoints;

  return {
    storageFlowPoints,
    includedDownloads,
    maxDownloadsBeforeExtraPoints,
    extraDownloads,
    extraFlowPoints,
    totalFlowPoints,
  };
}

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
        table: payload.role === 'sailor' ? 'sailor' : payload.role === 'seafarer' ? 'seafarer' : undefined
      })
      await next()
    } catch (error) {
      throw new HTTPException(401, { message: 'Access denied', cause: error })
    }
  }
}

