// deno-lint-ignore-file no-explicit-any
import Surreal, { PreparedQuery } from '@surrealdb/surrealdb'
import { accountTable, chatTable, responseTable, requestsToTable, connectsWithTable, conversesWithTable } from '../canal/canal.config.ts'


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

    if(tables.indexOf('account') < 0){
      const schema =  `${accountTable.table}\n` + Object.values(accountTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const account_info = await db.query<any[]>('INFO FOR TABLE account;')
      const presentFields = Object.entries(account_info[0].fields).map(field => field[0])
      for(const field in accountTable.fields){
        const key = field as keyof typeof accountTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(accountTable.fields[key])
        }
      }
    }

    if(tables.indexOf('chat') < 0){
      const schema =  `${chatTable.table}\n` + Object.values(chatTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const chat_info = await db.query<any[]>('INFO FOR TABLE chat;')
      const presentFields = Object.entries(chat_info[0].fields).map(field => field[0])
      for(const field in chatTable.fields){
        const key = field as keyof typeof chatTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(chatTable.fields[key])
        }
      }
    }

    if(tables.indexOf('response') < 0){
      const schema =  `${responseTable.table}\n` + Object.values(responseTable.fields).join('\n');
      const definition = new PreparedQuery(schema)
      await db.query(definition)
    } else { 
      const response_info = await db.query<any[]>('INFO FOR TABLE response;')
      const presentFields = Object.entries(response_info[0].fields).map(field => field[0])
      for(const field in responseTable.fields){
        const key = field as keyof typeof responseTable.fields;
        if(presentFields.indexOf(key) < 0){
          await db.query(responseTable.fields[key])
        }
      }
    }

    if(tables.indexOf('requests_to') < 0){
      const schema =  `${requestsToTable.table}\n` + Object.values(requestsToTable.fields).join('\n');
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
    }

    if(tables.indexOf('connects_with') < 0){
      const schema =  `${connectsWithTable.table}\n` + Object.values(connectsWithTable.fields).join('\n');
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
  } catch (error) {
    throw new Error('Database preparation failed', { cause: error })
  }
}