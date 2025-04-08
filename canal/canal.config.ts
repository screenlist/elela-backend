
/** TYPES */

export type Account = {
  id: string
  premium_usage: number
  premium_capacity: number
  standard_usage: number
  standard_capacity: number
  passphrase: string
  last_login: Date
  created_at: Date
  updated_at: Date
}

export type Chat = {
  id: string
  initiator_name: 'Mami'
  public_code: string
  start_time: Date
  end_time: Date
  created_at: Date
  updated_at: Date
}

export type Response = {
  id: string
  responder_name: 'Wata'
  secret_code: string
  public_code: string
  created_at: string
  updated_at: string
}

export type RequestsTo = {
  id: string
  in: string // Response
  out: string // Chat
  created_at: string
}

export type ConnectsWith = {
  id: string
  in: string // Response
  out: string // Chat
  created_at: string
}

export type ConversesWith =  {
  id: string
  in: string // Response
  out: string // Account
  chat: string // Chat
  from: string // Account || Response
  body: string
  reply_to: string // ConverseWith
  has_attachment: string
  created_at: string
}

/** DATABASE SCHEMAS */

export const accountTable = {
  table: 'DEFINE TABLE account SCHEMAFULL;',
  fields: {
    premium_usage: 'DEFINE FIELD premium_usage ON TABLE account TYPE number;',
    premium_capacity: 'DEFINE FIELD premium_capacity ON TABLE account TYPE number;',
    standard_usage: 'DEFINE FIELD standard_usage ON TABLE account TYPE number;',
    standard_capacity: 'DEFINE FIELD standard_capacity ON TABLE account TYPE number;',
    passphrase: 'DEFINE FIELD passphrase ON TABLE account TYPE string;',
    last_login: 'DEFINE FIELD last_login ON TABLE account TYPE datetime DEFAULT time::now();',
    created_at: 'DEFINE FIELD created_at ON TABLE account TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE account TYPE datetime DEFAULT time::now();'
  }
}

export const chatTable = {
  table: 'DEFINE TABLE chat SCHEMAFULL;',
  fields: {
    initiator_name: `DEFINE FIELD initiator_name ON TABLE chat TYPE string DEFAULT 'Mami' READONLY;`,
    public_code: 'DEFINE FIELD public_code ON TABLE chat TYPE string;',
    start_time: 'DEFINE FIELD start_time ON TABLE chat TYPE datetime;',
    end_time: 'DEFINE FIELD end_time ON TABLE chat TYPE datetime;',
    created_at: 'DEFINE FIELD created_at ON TABLE chat TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE chat TYPE datetime DEFAULT time::now();'
  }
}

export const responseTable = {
  table: 'DEFINE TABLE response SCHEMAFULL;',
  fields: {
    responder_name: `DEFINE FIELD responder_name ON TABLE response TYPE string DEFAULT 'Wata' READONLY;`,
    public_code: 'DEFINE FIELD public_code ON TABLE response TYPE string;',
    secret_code: 'DEFINE FIELD secret_code ON TABLE response TYPE string;',
    created_at: 'DEFINE FIELD created_at ON TABLE response TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE response TYPE datetime DEFAULT time::now();'
  }
}

export const requestsToTable = {
  table: 'DEFINE TABLE requests_to SCHEMAFULL;',
  fields: {
    in: 'DEFINE FIELD in ON TABLE requests_to TYPE record<response>;',
    out: 'DEFINE FIELD out ON TABLE requests_to TYPE record<chat>;',
    created_at: 'DEFINE FIELD created_at ON TABLE requests_to TYPE datetime DEFAULT time::now() READONLY;'
  }
}

export const connectsWithTable = {
  table: 'DEFINE TABLE connects_with SCHEMAFULL;',
  fields: {
    in: 'DEFINE FIELD in ON TABLE connects_with TYPE record<response>;',
    out: 'DEFINE FIELD out ON TABLE connects_with TYPE record<chat>;',
    created_at: 'DEFINE FIELD created_at ON TABLE connects_with TYPE datetime DEFAULT time::now() READONLY;'
  }
}

export const conversesWithTable = {
  table: 'DEFINE TABLE converses_with SCHEMAFULL;',
  fields: {
    in: 'DEFINE FIELD in ON TABLE converses_with TYPE record<response>;',
    out: 'DEFINE FIELD out ON TABLE converses_with TYPE record<account>;',
    chat: 'DEFINE FIELD chat ON TABLE converses_with TYPE record<chat>;',
    from: 'DEFINE FIELD from ON TABLE converses_with TYPE record<response|account>;',
    reply_to: 'DEFINE FIELD reply_to ON TABLE converses_with TYPE option<record<converses_with>>;',
    body: 'DEFINE FIELD body ON TABLE converses_with TYPE string ASSERT string::len($value) < 1000;',
    has_attachment: 'DEFINE FIELD has_attachment ON TABLE converses_with TYPE bool;',
    created_at: 'DEFINE FIELD created_at ON TABLE converses_with TYPE datetime DEFAULT time::now() READONLY;'
  }
}