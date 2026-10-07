import { defineEventHandler, createError, getCookie, getHeader, getRequestURL, getRequestWebStream,setCookie, setHeader, deleteCookie, type H3Event } from 'h3'
import {Readable} from 'node:stream'
import { ZodError } from 'zod'
import { Store, AppError, invariant } from '../../../../packages/database'
import { AuthService, type Identity } from '../services/auth'
import { GameService } from '../services/game'
import { ContentService } from '../services/content'

let runtime: { store: Store; auth: AuthService; game: GameService; content: ContentService } | undefined
export function services() {
  if (!runtime) { const store = new Store(); const content = new ContentService(store); content.seed(); runtime = { store, auth: new AuthService(store), game: new GameService(store), content } }
  return runtime
}
export const cookieName = 'careerscape_session'
export function cookieIsSecure(hostname:string){
  const loopback=['localhost','127.0.0.1','[::1]','::1'].includes(hostname)
  return process.env.NODE_ENV==='production' && !(loopback && process.env.COOKIE_SECURE==='false')
}
export function optionalIdentity(event: H3Event) { return services().auth.lookup(getCookie(event, cookieName)) }
export function identity(event: H3Event): Identity { const who = optionalIdentity(event); invariant(who, 'UNAUTHORIZED', 401, '请先进入游客模式或登录。'); return who }
export function authResponse(event: H3Event, response: { raw?: string; user: unknown; csrfToken: string; recoveryCodes?: string[] }) {
  if (response.raw) setCookie(event, cookieName, response.raw, { httpOnly: true, secure: cookieIsSecure(getRequestURL(event).hostname), sameSite: 'lax', path: '/', maxAge: 30 * 86400 })
  return { user: response.user, csrfToken: response.csrfToken, ...(response.recoveryCodes ? { recoveryCodes: response.recoveryCodes } : {}) }
}
export function clearAuth(event: H3Event) { deleteCookie(event, cookieName, { path: '/' }) }
export async function body(event: H3Event): Promise<unknown> {
  const length = Number(getHeader(event, 'content-length') || 0)
  invariant(Number.isFinite(length) && length <= 512_000, 'BODY_TOO_LARGE', 413, '请求内容过大。')
  const stream=event.web?.request?.body || (event.node.req instanceof Readable?Readable.toWeb(event.node.req):getRequestWebStream(event))
  if(!stream)return {}
  return parseLimitedJsonBody(stream as ReadableStream<Uint8Array>)
}
export async function parseLimitedJsonBody(stream:ReadableStream<Uint8Array>,limit=512_000):Promise<unknown>{
  const reader=stream.getReader(),chunks:Uint8Array[]=[]
  let bytes=0
  try{
    while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;invariant(bytes<=limit,'BODY_TOO_LARGE',413,'请求内容过大。');chunks.push(item.value)}
    if(!bytes)return {}
    const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)) as unknown}catch{throw new AppError('INVALID_JSON',400,'请求需要有效UTF-8 JSON。')}
  }catch(error){await reader.cancel().catch(()=>undefined);throw error}
  finally{reader.releaseLock()}
}
export function endpoint<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async event => {
    setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
    setHeader(event, 'Vary', 'Cookie')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
        const expectedOrigin = process.env.APP_ORIGIN || getRequestURL(event).origin
        invariant(getHeader(event, 'origin') === expectedOrigin, 'ORIGIN_REJECTED', 403, '仅接受来自本站页面的操作。')
        const who = optionalIdentity(event)
        if (who) services().auth.csrf(who, getHeader(event, 'x-csrf-token'))
      }
      return await handler(event)
    } catch (error) {
      if (error instanceof AppError) throw createError({ statusCode: error.statusCode, statusMessage: error.code, message: error.message, data: { code: error.code } })
      if (error instanceof ZodError) throw createError({ statusCode: 400, statusMessage: 'VALIDATION_ERROR', message: error.issues.map(i => i.message).join('；').slice(0, 500), data: { code: 'VALIDATION_ERROR' } })
      if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.constructor.name === 'NarrativeError') throw createError({ statusCode: 409, statusMessage: error.code, message: error instanceof Error ? error.message : '剧情操作不可用', data: { code: error.code } })
      // Never include prompts, request bodies, SQLite statements or auth secrets in errors.
      throw createError({ statusCode: 500, statusMessage: 'INTERNAL_ERROR', message: '操作暂时无法完成，请稍后重试。' })
    }
  })
}
