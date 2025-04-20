
/** TYPES */

import { RecordId } from "@surrealdb/surrealdb";

export type Canal = {
  id: RecordId<string>
  usage: number
  capacity: number
  is_premium: boolean
  passphrase: string
  last_login: Date
  created_at: Date
  updated_at: Date
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

export type ConversesWith =  {
  id: RecordId<string>
  in: RecordId<string> // Wave
  out: RecordId<string> // Canal
  chat: RecordId<string> // Bridge
  from: RecordId<string> // Canal || Wave
  body: string
  reply_to: RecordId<string> // ConverseWith
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
    passphrase: 'DEFINE FIELD passphrase ON TABLE canal TYPE string;',
    last_login: 'DEFINE FIELD last_login ON TABLE canal TYPE datetime DEFAULT time::now();',
    created_at: 'DEFINE FIELD created_at ON TABLE canal TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE canal TYPE datetime DEFAULT time::now();'
  },
  indices: {
    unique_passphrase: 'DEFINE INDEX unique_passphrase ON TABLE canal FIELDS passphrase UNIQUE;'
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

export const conversesWithTable = {
  table: 'DEFINE TABLE converses_with SCHEMAFULL TYPE RELATION IN wave OUT canal;',
  fields: {
    bridge: 'DEFINE FIELD bridge ON TABLE converses_with TYPE record<bridge>;',
    from: 'DEFINE FIELD from ON TABLE converses_with TYPE record<wave|canal>;',
    reply_to: 'DEFINE FIELD reply_to ON TABLE converses_with TYPE option<record<converses_with>>;',
    body: 'DEFINE FIELD body ON TABLE converses_with TYPE string ASSERT string::len($value) < 1000;',
    has_attachment: 'DEFINE FIELD has_attachment ON TABLE converses_with TYPE bool;',
    attachment: 'DEFINE FIELD attachment ON TABLE converses_with TYPE option<record<cargo>>;',
    created_at: 'DEFINE FIELD created_at ON TABLE converses_with TYPE datetime DEFAULT time::now() READONLY;'
  }
}