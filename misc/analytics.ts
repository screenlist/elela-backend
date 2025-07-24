import { PostHog } from 'posthog-node'

const host = Deno.env.get('POSTHOG_HOST')
const key = Deno.env.get('POSTHOG_KEY')
if(!key || !host){ throw new Error('Posthog key and host are both required') }

export const posthog = new PostHog(key, { host: host })