import { CronJob } from 'cron'
import { db } from "../database/config.ts";
import { surql } from "@surrealdb/surrealdb";

export const clean2faSetups = CronJob.from({
  cronTime: '0 * * * * *',
  onTick: async function(){
    await db.query(surql`DELETE auth WHERE expires_at < time::now();`)
  },
})

export const cleanUnactivatedCanals = CronJob.from({
  cronTime: '0 * * * * *',
  onTick: async function(){
    await db.query(surql`DELETE canal WHERE passphrase_hash = NONE AND created_at < time::now()-1m;`)
  },
})

export const cleanAbandonedPayments = CronJob.from({
  cronTime: '0 * * * * *',
  onTick: async function(){
    await db.query(surql`DELETE payment WHERE success = false AND created_at < time::now()-1d;`)
  },
})