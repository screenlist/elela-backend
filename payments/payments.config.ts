import { RecordId } from "@surrealdb/surrealdb";

export interface CoinAPIResponse {
  time: Date,
	asset_id_base: string,
	asset_id_quote: string,
	rate: number
}

export type Payment = {
  id: RecordId<string>
  amount: number
  points: number
  reference_code: string
  transaction_id?: number | string
  success: boolean
  currency: 'ZAR' | 'AVAX'
  created_at: Date
  updated_at: Date
}

export type Rate = {
  id: RecordId<string>
  base: 'USD'
  quote: 'ZAR' | 'AVAX'
  amount: number
  created_at: Date
  updated_at: Date
}

export const paymentTable = {
  table: 'DEFINE TABLE payment SCHEMAFULL;',
  fields: {
    points: 'DEFINE FIELD points ON TABLE payment TYPE number;',
    transaction_id: 'DEFINE FIELD transaction_id ON TABLE payment TYPE option<number|string>;',
    amount: 'DEFINE FIELD amount ON TABLE payment TYPE number ASSERT $value > 0;',
    reference_code: 'DEFINE FIELD reference_code ON TABLE payment TYPE string;',
    success: 'DEFINE FIELD success ON TABLE payment TYPE bool DEFAULT false;',
    currency: `DEFINE FIELD currency ON TABLE payment TYPE string ASSERT $value = /^(ZAR|AVAX)$/;`,
    created_at: 'DEFINE FIELD created_at ON TABLE payment TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE payment TYPE datetime DEFAULT time::now();'
  },
  indices: {
    unique_reference_code: 'DEFINE INDEX unique_reference_code ON TABLE payment FIELDS reference_code UNIQUE;'
  }
}

export const rateTable = {
  table: 'DEFINE TABLE rate SCHEMAFULL;',
  fields: {
    base: `DEFINE FIELD base ON TABLE rate TYPE string DEFAULT 'USD' ASSERT $value = 'USD';`,
    quote: `DEFINE FIELD quote ON TABLE rate TYPE string ASSERT $value = /^(ZAR|AVAX)$/;`,
    amount: 'DEFINE FIELD amount ON TABLE rate TYPE number ASSERT $value > 0;',
    created_at: 'DEFINE FIELD created_at ON TABLE rate TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE rate TYPE datetime DEFAULT time::now();'
  },
  indices: {
    unique_base_quote: 'DEFINE INDEX unique_base_quote ON TABLE rate FIELDS base, quote UNIQUE;'
  }
}