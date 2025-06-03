// deno-lint-ignore-file no-explicit-any
import Surreal, { PreparedQuery } from '@surrealdb/surrealdb'
import { canalTable, bridgeTable, waveTable, requestsToTable, connectsWithTable, conversationWithTable, authTable, sessionTable, visitTable } from '../canal/canal.config.ts'
import { paymentTable, rateTable } from "../payments/payments.config.ts"

export const db = await getSurreal()

async function getSurreal(): Promise<Surreal> {
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
    const database_info = await db.query<any[]>('INFO FOR DB;')
    const tables = Object.entries(database_info[0].tables).map(tab => tab[0])

    if(tables.indexOf('canal') < 0){
      const schema =  `${canalTable.table}\n` + Object.values(canalTable.fields).join('\n') + Object.values(canalTable.indices).join('\n');
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

      const presentIndexes = Object.entries(canal_info[0].indexes).map(field => field[0])
      for(const index in canalTable.indices){
        const key = index as keyof typeof canalTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(canalTable.indices[key])
        }
      }
    }

    if(tables.indexOf('bridge') < 0){
      const schema =  `${bridgeTable.table}\n` + Object.values(bridgeTable.fields).join('\n') + Object.values(bridgeTable.indices).join('\n');
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

      const presentIndexes = Object.entries(bridge_info[0].indexes).map(field => field[0])
      for(const index in bridgeTable.indices){
        const key = index as keyof typeof bridgeTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(bridgeTable.indices[key])
        }
      }
    }

    if(tables.indexOf('wave') < 0){
      const schema =  `${waveTable.table}\n` + Object.values(waveTable.fields).join('\n') + Object.values(waveTable.indices).join('\n');
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

      const presentIndexes = Object.entries(wave_info[0].indexes).map(field => field[0])
      for(const index in waveTable.indices){
        const key = index as keyof typeof waveTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(waveTable.indices[key])
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

    if(tables.indexOf('conversation_with') < 0){
      const schema =  `${conversationWithTable.table}\n` + Object.values(conversationWithTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const conversationWith_info = await db.query<any[]>('INFO FOR TABLE conversation_with;')
      const presentFields = Object.entries(conversationWith_info[0].fields).map(field => field[0])
      for(const field in conversationWithTable.fields){
        const key = field as keyof typeof conversationWithTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(conversationWithTable.fields[key])
        }
      }
    }

    if(tables.indexOf('payment') < 0){
      const schema =  `${paymentTable.table}\n` + Object.values(paymentTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const payment_info = await db.query<any[]>('INFO FOR TABLE payment;')

      const presentFields = Object.entries(payment_info[0].fields).map(field => field[0])
      for(const field in paymentTable.fields){
        const key = field as keyof typeof paymentTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(paymentTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(payment_info[0].indexes).map(field => field[0])
      for(const index in paymentTable.indices){
        const key = index as keyof typeof paymentTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(paymentTable.indices[key])
        }
      }
    }

    if(tables.indexOf('rate') < 0){
      const schema =  `${rateTable.table}\n` + Object.values(rateTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const rate_info = await db.query<any[]>('INFO FOR TABLE rate;')

      const presentFields = Object.entries(rate_info[0].fields).map(field => field[0])
      for(const field in rateTable.fields){
        const key = field as keyof typeof rateTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(rateTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(rate_info[0].indexes).map(field => field[0])
      for(const index in rateTable.indices){
        const key = index as keyof typeof rateTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(rateTable.indices[key])
        }
      }
    }

    if(tables.indexOf('auth') < 0){
      const schema =  `${authTable.table}\n` + Object.values(authTable.fields).join('\n') + Object.values(authTable.indices).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const auth_info = await db.query<any[]>('INFO FOR TABLE auth;')

      const presentFields = Object.entries(auth_info[0].fields).map(field => field[0])
      for(const field in authTable.fields){
        const key = field as keyof typeof authTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(authTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(auth_info[0].indexes).map(field => field[0])
      for(const index in authTable.indices){
        const key = index as keyof typeof authTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(authTable.indices[key])
        }
      }
    }

    if(tables.indexOf('session') < 0){
      const schema =  `${sessionTable.table}\n` + Object.values(sessionTable.fields).join('\n') + Object.values(sessionTable.indices).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const session_info = await db.query<any[]>('INFO FOR TABLE session;')

      const presentFields = Object.entries(session_info[0].fields).map(field => field[0])
      for(const field in sessionTable.fields){
        const key = field as keyof typeof sessionTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(sessionTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(session_info[0].indexes).map(field => field[0])
      for(const index in sessionTable.indices){
        const key = index as keyof typeof sessionTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(sessionTable.indices[key])
        }
      }
    }

    if(tables.indexOf('visit') < 0){
      const schema =  `${visitTable.table}\n` + Object.values(visitTable.fields).join('\n') + Object.values(visitTable.indices).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const visit_info = await db.query<any[]>('INFO FOR TABLE visit;')

      const presentFields = Object.entries(visit_info[0].fields).map(field => field[0])
      for(const field in visitTable.fields){
        const key = field as keyof typeof visitTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(visitTable.fields[key])
        }
      }

      const presentIndexes = Object.entries(visit_info[0].indexes).map(field => field[0])
      for(const index in visitTable.indices){
        const key = index as keyof typeof visitTable.indices;
        if(presentIndexes.indexOf(key) < 0){
          await db.query(visitTable.indices[key])
        }
      }
    }
  } catch (error) {
    console.log(error)
    throw new Error('Database preparation failed', { cause: error })
  }
}