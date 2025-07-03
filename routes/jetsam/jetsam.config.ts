import { RecordId } from "@surrealdb/surrealdb"

export interface Information {
  id: string
  file_id?: string
  session_id?: string
  url: string
  token: string
  multipart: boolean
  name: string
  sha1: string
  size: number
  type: string
}

export type Cargo = {
  id: RecordId<string>
  canal: RecordId<string>
  bridge?: RecordId<string>
  b2_file_id?: string
  subpoints: number
  downloads_count: number
  downloads_total: number
  name: string
  original_filename: string
  content_type: string
  sha1: string
  size: number
  is_complete: boolean
  is_independent: boolean
  is_public: boolean
  public_code?: string
  flookey_active_from?: Date
  storage_valid_until: Date
  created_at: Date
  updated_at: Date
}

export type UploadSession = {
  id: RecordId<string>
  cargo: RecordId<string>
  total_chunks: number
  uploaded_chunks: {
    index: number
    sha1: string
    size: number
  }[]
  created_at: Date
  updated_at: Date
}

export type OpenedBy = {
  id: RecordId<string>
  in: RecordId<string> // Cargo
  out: RecordId<string> // Wave || Canal
  created_at: string
}

export const cargoTable = {
  table: 'DEFINE TABLE cargo SCHEMAFULL;',
  fields: {
    canal: 'DEFINE FIELD canal ON TABLE cargo TYPE record<canal>;',
    bridge: 'DEFINE FIELD bridge ON TABLE cargo TYPE option<record<bridge>>;',
    b2_file_id: 'DEFINE FIELD b2_file_id ON TABLE cargo TYPE option<string>;',
    subpoints: 'DEFINE FIELD subpoints ON TABLE cargo TYPE number;',
    downloads_count: 'DEFINE FIELD downloads_count ON TABLE cargo TYPE number;',
    downloads_total: 'DEFINE FIELD downloads_total ON TABLE cargo TYPE number;',
    name: 'DEFINE FIELD name ON TABLE cargo TYPE string;',
    original_filename: 'DEFINE FIELD original_filename ON TABLE cargo TYPE string;',
    content_type: 'DEFINE FIELD content_type ON TABLE cargo TYPE string;',
    sha1: 'DEFINE FIELD sha1 ON TABLE cargo TYPE string;',
    size: 'DEFINE FIELD size ON TABLE cargo TYPE number;',
    is_complete: 'DEFINE FIELD is_complete ON TABLE cargo TYPE bool;',
    is_independent: 'DEFINE FIELD is_independent ON TABLE cargo TYPE bool;',
    is_public: 'DEFINE FIELD is_public ON TABLE cargo TYPE bool;',
    public_code: 'DEFINE FIELD public_code ON TABLE cargo TYPE option<string>;',
    flookey_active_from: 'DEFINE FIELD flookey_active_from ON TABLE cargo TYPE option<datetime>;',
    storage_valid_until: 'DEFINE FIELD storage_valid_until ON TABLE cargo TYPE datetime;',
    created_at: 'DEFINE FIELD created_at ON TABLE cargo TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE cargo TYPE datetime DEFAULT ALWAYS time::now();'
  },
  indices: {
    unique_b2_file_id: 'DEFINE INDEX unique_b2_file_id ON TABLE cargo FIELDS b2_file_id UNIQUE;'
  }
}

export const uploadSessionTable = {
  table: 'DEFINE TABLE upload_session SCHEMAFULL;',
  fields: {
    cargo: 'DEFINE FIELD cargo ON TABLE upload_session TYPE record<cargo>;',
    total_chunks: 'DEFINE FIELD total_chunks ON TABLE upload_session TYPE number;',
    created_at: 'DEFINE FIELD created_at ON TABLE upload_session TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE upload_session TYPE datetime DEFAULT ALWAYS time::now();',
    uploaded_chunks: 'DEFINE FIELD uploaded_chunks ON TABLE upload_session TYPE array<object> DEFAULT ALWAYS [];',
    'uploaded_chunks[*].index': 'DEFINE FIELD uploaded_chunks[*].index ON TABLE upload_session TYPE number;',
    'uploaded_chunks[*].sha1': 'DEFINE FIELD uploaded_chunks[*].sha1 ON TABLE upload_session TYPE string;',
    'uploaded_chunks[*].size': 'DEFINE FIELD uploaded_chunks[*].size ON TABLE upload_session TYPE number;'
  },
  indices: {
    unique_cargo: 'DEFINE INDEX unique_cargo ON TABLE upload_session FIELDS cargo UNIQUE;',
    unique_uploaded_chunks_index: 'DEFINE INDEX unique_uploaded_chunks_index ON TABLE upload_session FIELDS uploaded_chunks[*].index UNIQUE;'
  }
}

export const openedByTable = {
  table: 'DEFINE TABLE opened_by SCHEMAFULL TYPE RELATION IN cargo OUT wave|canal;',
  fields: {
    created_at: 'DEFINE FIELD created_at ON TABLE opened_by TYPE datetime DEFAULT time::now() READONLY;'
  },
  indices: {}
}