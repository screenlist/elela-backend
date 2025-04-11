// deno-lint-ignore-file no-explicit-any
import Surreal, { PreparedQuery } from '@surrealdb/surrealdb'
import { canalTable, bridgeTable, waveTable, requestsToTable, connectsWithTable, conversesWithTable } from '../canal/canal.config.ts'
import { paymentFiatTable } from "../payments/payments.config.ts"

export async function getSurreal(): Promise<Surreal> {
  const url = Deno.env.get('DB_URL')
  const user = Deno.env.get('DB_USER')
  const pass = Deno.env.get('DB_PASS')
  const namespace = Deno.env.get('DB_NS')
  const database = Deno.env.get('DB_DB')
  const connection = new Surreal()
  if(!url || !user || !pass || !namespace || !database){
    await connection.close()
    throw new Error('Database connection not established: DB_URL, DB_USER, DB_PASS, DB_NS & DB_DB variables must be provided.')
  }

  try {
    await connection.connect(url, {
      auth: {
        password: pass,
        username: user
      },
      namespace: namespace,
      database: database
    })
    console.log('Database successfully connected to '+namespace+' namespace and '+database+' database.')
    return connection
  } catch (error) {
    console.log('Database connection error: ', error)
    await connection.close()
    throw new Error('Failed to connect to database', { cause: error })
  }
}

export async function startUpDatabase(){
  try {
    const db = await getSurreal()
    const database_info = await db.query<any[]>('INFO FOR DB;')
    const tables = Object.entries(database_info[0].tables).map(tab => tab[0])

    if(tables.indexOf('canal') < 0){
      const schema =  `${canalTable.table}\n` + Object.values(canalTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const canal_info = await db.query<any[]>('INFO FOR TABLE canal;')
      const presentFields = Object.entries(canal_info[0].fields).map(field => field[0])
      for(const field in canalTable.fields){
        const key = field as keyof typeof canalTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(canalTable.fields[key])
        }
      }
    }

    if(tables.indexOf('bridge') < 0){
      const schema =  `${bridgeTable.table}\n` + Object.values(bridgeTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const bridge_info = await db.query<any[]>('INFO FOR TABLE bridge;')
      const presentFields = Object.entries(bridge_info[0].fields).map(field => field[0])
      for(const field in bridgeTable.fields){
        const key = field as keyof typeof bridgeTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(bridgeTable.fields[key])
        }
      }
    }

    if(tables.indexOf('wave') < 0){
      const schema =  `${waveTable.table}\n` + Object.values(waveTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const wave_info = await db.query<any[]>('INFO FOR TABLE wave;')
      const presentFields = Object.entries(wave_info[0].fields).map(field => field[0])
      for(const field in waveTable.fields){
        const key = field as keyof typeof waveTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(waveTable.fields[key])
        }
      }
    }

    if(tables.indexOf('requests_to') < 0){
      const schema =  `${requestsToTable.table}\n` + Object.values(requestsToTable.fields).join('\n') + Object.values(requestsToTable.indices).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const requestsTo_info = await db.query<any[]>('INFO FOR TABLE requests_to;')

      const presentFields = Object.entries(requestsTo_info[0].fields).map(field => field[0])
      for(const field in requestsToTable.fields){
        const key = field as keyof typeof requestsToTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(requestsToTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(requestsTo_info[0].indexes).map(field => field[0])
      for(const index in requestsToTable.indices){
        const key = index as keyof typeof requestsToTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(requestsToTable.indices[key])
        }
      }
    }

    if(tables.indexOf('connects_with') < 0){
      const schema =  `${connectsWithTable.table}\n` + Object.values(connectsWithTable.fields).join('\n') + Object.values(connectsWithTable.indices).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const connectsWith_info = await db.query<any[]>('INFO FOR TABLE connects_with;')

      const presentFields = Object.entries(connectsWith_info[0].fields).map(field => field[0])
      for(const field in connectsWithTable.fields){
        const key = field as keyof typeof connectsWithTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(connectsWithTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(connectsWith_info[0].indexes).map(field => field[0])
      for(const index in connectsWithTable.indices){
        const key = index as keyof typeof connectsWithTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(connectsWithTable.indices[key])
        }
      }
    }

    if(tables.indexOf('converses_with') < 0){
      const schema =  `${conversesWithTable.table}\n` + Object.values(conversesWithTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const conversesWith_info = await db.query<any[]>('INFO FOR TABLE converses_with;')
      const presentFields = Object.entries(conversesWith_info[0].fields).map(field => field[0])
      for(const field in conversesWithTable.fields){
        const key = field as keyof typeof conversesWithTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(conversesWithTable.fields[key])
        }
      }
    }

    if(tables.indexOf('payment_fiat') < 0){
      const schema =  `${paymentFiatTable.table}\n` + Object.values(paymentFiatTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const paymentFiat_info = await db.query<any[]>('INFO FOR TABLE payment_fiat;')
      const presentFields = Object.entries(paymentFiat_info[0].fields).map(field => field[0])
      for(const field in paymentFiatTable.fields){
        const key = field as keyof typeof paymentFiatTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(paymentFiatTable.fields[key])
        }
      }
    }
  } catch (error) {
    throw new Error('Database preparation failed', { cause: error })
  }
}