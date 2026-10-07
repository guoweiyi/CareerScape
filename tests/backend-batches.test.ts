import {describe,it,expect} from 'vitest'
import {Store} from '../packages/database'
import {ContentService} from '../apps/web/server/services/content'
import {AuthService} from '../apps/web/server/services/auth'
import {BatchService} from '../apps/web/server/services/batches'
import {demoPack} from '../packages/content/seed'

function setup(){const store=new Store(':memory:');new ContentService(store).seed();const auth=new AuthService(store),guest=auth.guest(),identity=auth.lookup('raw' in guest?guest.raw:undefined)!;identity.user.roles=['editor'];return{store,identity,batches:new BatchService(store)}}
describe('mock content batch administration',()=>{
  it('pauses at budget, resumes failed/planned items, persists cursor and protects published candidates',async()=>{
    const {store,identity,batches}=setup()
    try{
      const planned=await batches.mutate(identity,{action:'plan',packId:demoPack.id,version:demoPack.version,maxTokens:0})
      const batchId=planned.batch.id
      const paused=await batches.mutate(identity,{action:'generate',packId:demoPack.id,version:demoPack.version,batchId})
      expect(paused.batch.status).toBe('paused');expect(paused.batch.cursor).toBe(0)
      const generated=await batches.mutate(identity,{action:'resume',packId:demoPack.id,version:demoPack.version,batchId,maxTokens:10000})
      expect(generated.batch.status).toBe('completed');expect(generated.batch.cursor).toBe(demoPack.events.length)
      const tokens=generated.batch.budget.usedTokens
      const repeated=await batches.mutate(identity,{action:'resume',packId:demoPack.id,version:demoPack.version,batchId})
      expect(repeated.batch.budget.usedTokens).toBe(tokens)
      const candidate=repeated.batch.items[0]!.candidate!
      store.run("UPDATE templates SET content_status='published' WHERE id=?",candidate.id)
      await batches.mutate(identity,{action:'validate',packId:demoPack.id,version:demoPack.version,batchId})
      expect(store.get<{content_status:string}>('SELECT content_status FROM templates WHERE id=?',candidate.id)!.content_status).toBe('published')
      expect(batches.list(identity).batches).toHaveLength(1)
    }finally{store.close()}
  })
  it('restricts editing roles and previews without creating a player save',async()=>{
    const {store,identity,batches}=setup()
    try{
      const before=store.get<{n:number}>('SELECT COUNT(*) n FROM sessions')!.n
      const preview=batches.preview(identity,{packId:demoPack.id,version:demoPack.version,seed:'preview'})
      expect(preview.previewOnly).toBe(true);expect(preview.instance.slotMapping).toHaveProperty('arrival')
      expect(store.get<{n:number}>('SELECT COUNT(*) n FROM sessions')!.n).toBe(before)
      identity.user.roles=['reviewer']
      await expect(batches.mutate(identity,{action:'plan',packId:demoPack.id,version:demoPack.version})).rejects.toMatchObject({code:'FORBIDDEN'})
    }finally{store.close()}
  })
})
