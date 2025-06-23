import { WSContext } from "@hono/hono/ws"

/** INTERFACES */

export interface Broadcaster {
  clients: Map<string, WSContext<WebSocket>>, 
  sender: string, 
  everywhere: boolean, 
  message: string
}

export interface Message {
  type: 'text' | 'error' | 'joined' | 'left' | 'typing' | 'text_sent'
  data: {
    message: string
    cargo?: string
  }
}

/** TYPES */

import { RecordId } from "@surrealdb/surrealdb";

export type Canal = {
  id: RecordId<string>
  usage: number
  capacity: number
  is_premium: boolean
  letter_sequence: string
  passphrase_hash?: string
  passphrase_salt: string
  auth_secret?: string
  auth_salt?: string
  totp_enabled: boolean
  created_at: Date
  updated_at: Date
}

export type Session = {
  id: RecordId<string>
  canal: RecordId<string>
  browser: string
  device: string
  os: string
  created_at: Date
  expires_at: Date
}

export type Visit = {
  id: RecordId<string>
  wave: RecordId<string>
  browser: string
  device: string
  os: string
  created_at: Date
  expires_at: Date
}

export type Auth = {
  id: RecordId<string>
  canal: RecordId<string>
  token: string
  attempts: number
  created_at: Date
  expires_at: Date
}

export type Bridge = {
  id: RecordId<string>
  canal: RecordId<string>
  initiator_name: 'Sailor'
  public_code: string
  start_time: Date
  end_time: Date
  created_at: Date
  updated_at: Date
}

export type Wave = {
  id: RecordId<string>
  responder_name: 'Seafarer'
  secret_code: string
  secret_salt: string
  public_code: string
  created_at: string
  updated_at: string
}

export type RequestsTo = {
  id: RecordId<string>
  in: RecordId<string> // Wave
  out: RecordId<string> // Bridge
  created_at: string
}

export type ConnectsWith = {
  id: RecordId<string>
  in: RecordId<string> // Wave
  out: RecordId<string> // Bridge
  created_at: string
}

export type ConversationWith =  {
  id: RecordId<string>
  in: RecordId<string> // Wave || Bridge
  out: RecordId<string> // ConnectsWith 
  body: string
  reply_to?: RecordId<string> // ConversationWith
  has_attachment: boolean
  attachment?: RecordId<string>
  created_at: string
}

/** DATABASE SCHEMAS */

export const canalTable = {
  table: 'DEFINE TABLE canal SCHEMAFULL;',
  fields: {
    usage: 'DEFINE FIELD usage ON TABLE canal TYPE number;',
    capacity: 'DEFINE FIELD capacity ON TABLE canal TYPE number;',
    is_premium: 'DEFINE FIELD is_premium ON TABLE canal TYPE bool;',
    passphrase_hash: 'DEFINE FIELD passphrase_hash ON TABLE canal TYPE option<string>;',
    passphrase_salt: 'DEFINE FIELD passphrase_salt ON TABLE canal TYPE string;',
    letter_sequence: 'DEFINE FIELD letter_sequence ON TABLE canal TYPE string;',
    totp_enabled: 'DEFINE FIELD totp_enabled ON TABLE canal TYPE bool DEFAULT false;',
    auth_secret: 'DEFINE FIELD auth_secret ON TABLE canal TYPE option<string>;',
    auth_salt: 'DEFINE FIELD auth_salt ON TABLE canal TYPE option<string>;',
    created_at: 'DEFINE FIELD created_at ON TABLE canal TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE canal TYPE datetime DEFAULT ALWAYS time::now();'
  },
  indices: {
    unique_letter_sequence: 'DEFINE INDEX unique_letter_sequence ON TABLE canal FIELDS letter_sequence UNIQUE;'
  }
}

export const sessionTable = {
  table: 'DEFINE TABLE session SCHEMAFULL;',
  fields: {
    canal: 'DEFINE FIELD canal ON TABLE session TYPE record<canal>;',
    browser: 'DEFINE FIELD browser ON TABLE session TYPE string;',
    device: 'DEFINE FIELD device ON TABLE session TYPE string;',
    os: 'DEFINE FIELD os ON TABLE session TYPE string;',
    created_at: `DEFINE FIELD created_at ON TABLE session TYPE datetime DEFAULT time::now() READONLY;`,
    expires_at: `DEFINE FIELD expires_at ON TABLE session TYPE datetime;`
  },
  indices: {}
}

export const visitTable = {
  table: 'DEFINE TABLE visit SCHEMAFULL;',
  fields: {
    wave: 'DEFINE FIELD wave ON TABLE visit TYPE record<wave>;',
    browser: 'DEFINE FIELD browser ON TABLE visit TYPE string;',
    device: 'DEFINE FIELD device ON TABLE visit TYPE string;',
    os: 'DEFINE FIELD os ON TABLE visit TYPE string;',
    created_at: `DEFINE FIELD created_at ON TABLE visit TYPE datetime DEFAULT time::now() READONLY;`,
    expires_at: `DEFINE FIELD expires_at ON TABLE visit TYPE datetime;`
  },
  indices: {
    unique_wave: 'DEFINE INDEX unique_wave ON TABLE visit FIELDS wave UNIQUE;'
  }
}

export const authTable = {
  table: 'DEFINE TABLE auth SCHEMAFULL;',
  fields: {
    canal: 'DEFINE FIELD canal ON TABLE auth TYPE record<canal>;',
    token: 'DEFINE FIELD token ON TABLE auth TYPE string;',
    attempts: 'DEFINE FIELD attempts ON TABLE auth TYPE number DEFAULT 3 ASSERT $value >= 0;',
    created_at: `DEFINE FIELD created_at ON TABLE auth TYPE datetime DEFAULT time::now() READONLY;`,
    expires_at: `DEFINE FIELD expires_at ON TABLE auth TYPE datetime;`
  },
  indices: {
    unique_canal: 'DEFINE INDEX unique_canal ON TABLE auth FIELDS canal UNIQUE;'
  }
}

export const bridgeTable = {
  table: 'DEFINE TABLE bridge SCHEMAFULL;',
  fields: {
    canal: 'DEFINE FIELD canal ON TABLE bridge TYPE record<canal>;',
    initiator_name: `DEFINE FIELD initiator_name ON TABLE bridge TYPE string DEFAULT 'Sailor' READONLY;`,
    public_code: 'DEFINE FIELD public_code ON TABLE bridge TYPE string;',
    start_time: 'DEFINE FIELD start_time ON TABLE bridge TYPE datetime;',
    end_time: 'DEFINE FIELD end_time ON TABLE bridge TYPE datetime;',
    created_at: 'DEFINE FIELD created_at ON TABLE bridge TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE bridge TYPE datetime DEFAULT time::now();'
  },
  indices: {
    unique_public_code: 'DEFINE INDEX unique_public_code ON TABLE bridge FIELDS public_code UNIQUE;'
  }
}

export const waveTable = {
  table: 'DEFINE TABLE wave SCHEMAFULL;',
  fields: {
    responder_name: `DEFINE FIELD responder_name ON TABLE wave TYPE string DEFAULT 'Seafarer' READONLY;`,
    public_code: 'DEFINE FIELD public_code ON TABLE wave TYPE string;',
    secret_code: 'DEFINE FIELD secret_code ON TABLE wave TYPE string;',
    secret_salt: 'DEFINE FIELD secret_salt ON TABLE wave TYPE string;',
    created_at: 'DEFINE FIELD created_at ON TABLE wave TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE wave TYPE datetime DEFAULT time::now();'
  },
  indices: {
    unique_public_code: 'DEFINE INDEX unique_public_code ON TABLE wave FIELDS public_code UNIQUE;'
  }
}

export const requestsToTable = {
  table: 'DEFINE TABLE requests_to SCHEMAFULL TYPE RELATION IN wave OUT bridge;',
  fields: {
    created_at: 'DEFINE FIELD created_at ON TABLE requests_to TYPE datetime DEFAULT time::now() READONLY;'
  },
  indices: {
    unique_in_out: 'DEFINE INDEX unique_in_out ON TABLE requests_to FIELDS in, out UNIQUE;'
  }
}

export const connectsWithTable = {
  table: 'DEFINE TABLE connects_with SCHEMAFULL TYPE RELATION IN wave OUT bridge;',
  fields: {
    created_at: 'DEFINE FIELD created_at ON TABLE connects_with TYPE datetime DEFAULT time::now() READONLY;'
  },
  indices: {
    unique_in_out: 'DEFINE INDEX unique_in_out ON TABLE connects_with FIELDS in, out UNIQUE;'
  }
}

export const conversationWithTable = {
  table: 'DEFINE TABLE conversation_with SCHEMAFULL TYPE RELATION IN wave|bridge OUT connects_with;',
  fields: {
    reply_to: 'DEFINE FIELD reply_to ON TABLE conversation_with TYPE option<record<conversation_with>>;',
    body: 'DEFINE FIELD body ON TABLE conversation_with TYPE string ASSERT string::len($value) < 1000;',
    has_attachment: 'DEFINE FIELD has_attachment ON TABLE conversation_with TYPE bool;',
    attachment: 'DEFINE FIELD attachment ON TABLE conversation_with TYPE option<record<cargo>>;',
    created_at: 'DEFINE FIELD created_at ON TABLE conversation_with TYPE datetime DEFAULT time::now() READONLY;'
  }
}