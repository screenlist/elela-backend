

export type PaymentFiat = {
  id: string
  amount: string
  points: number
  reference_code: string
  transaction_id?: number
  success: boolean
  created_at: Date
  updated_at: Date
}

export const paymentFiatTable = {
  table: 'DEFINE TABLE payment_fiat SCHEMAFULL;',
  fields: {
    points: 'DEFINE FIELD points ON TABLE payment_fiat TYPE number;',
    transaction_id: 'DEFINE FIELD transaction_id ON TABLE payment_fiat TYPE option<number>;',
    amount: 'DEFINE FIELD amount ON TABLE payment_fiat TYPE string;',
    reference_code: 'DEFINE FIELD reference_code ON TABLE payment_fiat TYPE string;',
    success: 'DEFINE FIELD success ON TABLE payment_fiat TYPE bool DEFAULT false;',
    created_at: 'DEFINE FIELD created_at ON TABLE payment_fiat TYPE datetime DEFAULT time::now() READONLY;',
    updated_at: 'DEFINE FIELD updated_at ON TABLE payment_fiat TYPE datetime DEFAULT time::now();'
  }
}