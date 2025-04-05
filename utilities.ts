

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

function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer)
  return Array.from(byteArray).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, 2), 16);
  }
  return bytes;
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

  while(set.length < 6){
    const charset = '123456'
    let dice = ''
    const randomValues = crypto.getRandomValues(new Uint8Array(length))
    for(let i = 0; i < length; i++){
      dice += charset[randomValues[i]% charset.length] 
    }
    set.push(dice)
  }
  
  const phrase: string[] = set.map(value => words[value]['original_word'])
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