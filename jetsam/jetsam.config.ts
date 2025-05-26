import { RecordId } from "@surrealdb/surrealdb";

export type Cargo = {
  id: RecordId<string>
  b2_file_id: string
  points: number
  downloads: number
  name: string
  content_type: string
  size: number
  upload_complete: boolean
  is_independent: boolean
  is_public: boolean
  public_code?: string
  flookey_active_from: Date
  storage_valid_until: Date
  created_at: Date
  updated_at: Date
}

export type UploadSession = {
  id: RecordId<string>
  total_chunks: number
  
}