import {describe,it,expect} from 'vitest'
import {Store} from '../packages/database'
import {AuthService} from '../apps/web/server/services/auth'
import {ContentService} from '../apps/web/server/services/content'
import {GameService} from '../apps/web/server/services/game'
import type {RoleProvider} from '../packages/agent'
import {demoPack} from '../packages/content/seed'
import {frameFactory} from '../packages/contracts'

describe('UTF-8 snapshot transport budgets',()=>{
  it('keeps complete recent messages below 100KB and a committed JSONL frame below 256KB',async()=>{
    const store=new Store(':memory:')
    try{
      new ContentService(store).seed()
      const guest=new AuthService(store).guest()
      const provider:RoleProvider={name:'mock',async generate(){return{text:'答'.repeat(3000),provider:'mock',modelVersion:'capacity-test',promptVersion:'test',inputTokens:0,outputTokens:0,latencyMs:0,factIds:[],costEstimate:0,costSource:'test fixture'}}}
      const game=new GameService(store,provider);let session=game.create(guest.user.id,{packId:demoPack.id})
      for(let turn=0;turn<32;turn++)session=(await game.act(guest.user.id,session.id,{clientActionId:crypto.randomUUID(),branchId:session.branchId,expectedRevision:session.revision,kind:'message',text:'问'.repeat(2000),channel:'group'})).session
      expect(session.hasMoreHistory).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(session.messages),'utf8')).toBeLessThanOrEqual(100000)
      expect(session.messages.at(-1)?.text).toBe('答'.repeat(3000))
      expect(session.node.choices).toEqual([]);expect(session.choices.every(choice=>choice.messages.length===0)).toBe(true)
      const factory=frameFactory({streamId:'capacity-stream',turnId:'capacity-turn',sessionId:session.id,branchId:session.branchId})
      const frame=factory('turn_committed',{revision:session.revision,eventSeq:session.eventSeq,messageIds:session.messages.slice(-2).map(message=>message.id),session})
      expect(Buffer.byteLength(JSON.stringify(frame),'utf8')).toBeLessThan(256000)
      const allIds=new Set(session.messages.map(message=>message.id));let before:number|undefined=session.messages[0]!.eventSeq
      while(before){const page=game.history(guest.user.id,session.id,session.branchId,before);for(const message of page.messages)allIds.add(message.id);before=page.hasMore?page.nextBeforeEventSeq||undefined:undefined}
      expect([...allIds].sort()).toEqual(game.messages(game.lineage(session.id,session.branchId)).map(message=>message.id).sort())
    }finally{store.close()}
  })
})
