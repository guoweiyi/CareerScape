import {z} from 'zod'
import type {Store} from '../../../../packages/database'
import {canonical,hash,invariant} from '../../../../packages/database'
import {BatchSchema,planBatch,runBatch,validateBatch,type ContentBatch} from '../../../../packages/content/pipeline'
import {assemble,choicesFor,startState,validatePack} from '../../../../packages/narrative/engine'
import {AuthService,type Identity} from './auth'
import {ContentService,checkAssets} from './content'
import {EventTemplateSchema,type ContentPack} from '../../../../packages/contracts'

const PackInput=z.object({packId:z.string().min(1).max(80),version:z.number().int().positive()})
const BatchInput=PackInput.extend({action:z.enum(['plan','generate','validate','resume']),batchId:z.string().min(1).max(200).optional(),variant:z.string().max(80).optional(),maxTokens:z.number().int().min(0).max(50000).optional(),dryRun:z.boolean().default(false)}).strict()
export class BatchService{
  constructor(readonly store:Store){}
  list(identity:Identity){
    new AuthService(this.store).requireRole(identity,['editor','reviewer','admin'])
    return {provider:'mock',batches:this.store.all<{payload:string}>('SELECT payload FROM content_batches ORDER BY rowid DESC LIMIT 50').map(row=>BatchSchema.parse(JSON.parse(row.payload)))}
  }
  preview(identity:Identity,raw:unknown){
    new AuthService(this.store).requireRole(identity,['editor'])
    const input=PackInput.extend({seed:z.string().min(1).max(80)}).strict().parse(raw)
    const pack=new ContentService(this.store).get(input.packId,input.version),validation=validatePack(pack)
    invariant(validation.valid,'CONTENT_INVALID',400,validation.issues.join('；'))
    // Preview is explicit and read-only: it does not publish a draft or create a player save.
    const previewPack={...pack,contentStatus:'published' as const,events:pack.events.map(event=>({...event,contentStatus:'published' as const}))}
    const instance=assemble(previewPack,input.seed),state=startState(previewPack)
    return {previewOnly:true,sourceStatus:pack.contentStatus,instance,state,choices:choicesFor(previewPack,state),assetGate:checkAssets(pack),note:'内容编辑预览，不创建玩家存档，不改变审核/发布状态。'}
  }
  async mutate(identity:Identity,raw:unknown){
    new AuthService(this.store).requireRole(identity,['editor'])
    const input=BatchInput.parse(raw),pack=new ContentService(this.store).get(input.packId,input.version)
    const prefix=`batch-${hash(pack.id).slice(0,8)}-v${pack.version}-`
    const planned=planBatch(pack,{maxTokens:input.maxTokens,maxCostUSD:0,variant:`${pack.id}@${pack.version}:${pack.contentBuildId}:${input.variant||'admin-mock'}`})
    planned.id=prefix+planned.configHash.slice(0,20)
    const batchId=input.batchId||planned.id
    invariant(batchId.startsWith(prefix),'BATCH_PACK_MISMATCH',400,'批次必须使用创建时固定的职业包版本。')
    const existing=this.store.get<{payload:string}>('SELECT payload FROM content_batches WHERE id=?',batchId)
    invariant(input.action==='plan'||existing,'BATCH_NOT_FOUND',404,'请先创建批次计划。')
    let batch=existing?BatchSchema.parse(JSON.parse(existing.payload)):planned
    for(const item of batch.items){
      if(!item.candidate)continue
      const reviewed=this.store.get<{content_status:string;payload:string}>('SELECT content_status,payload FROM templates WHERE id=? AND version=?',item.candidate.id,String(item.candidate.version))
      if(reviewed&&(reviewed.content_status==='approved'||reviewed.content_status==='published')){item.status=reviewed.content_status;item.candidate=EventTemplateSchema.parse({...JSON.parse(reviewed.payload),contentStatus:reviewed.content_status})}
    }
    if(input.maxTokens!==undefined)batch.budget.maxTokens=input.maxTokens
    if(input.dryRun)return {dryRun:true,provider:'mock',batch,estimatedTokens:batch.items.filter(i=>['planned','failed'].includes(i.status)).reduce((n,i)=>n+i.estimatedTokens,0),estimatedCostUSD:0}
    if(input.action==='generate'||input.action==='resume')batch=await runBatch(batch,pack)
    if(input.action==='validate')batch=validateBatch(batch,pack)
    this.save(identity,pack,batch,input.action,existing?.payload)
    return {dryRun:false,provider:'mock',batch,assetGate:checkAssets(pack),note:'仅合成mock候选，不调用付费模型；候选不能直接进入游戏。'}
  }
  private save(identity:Identity,pack:ContentPack,batch:ContentBatch,action:string,expectedPayload?:string){
    this.store.transaction(()=>{
      const current=this.store.get<{payload:string}>('SELECT payload FROM content_batches WHERE id=?',batch.id)
      invariant(current?.payload===expectedPayload,'BATCH_CONFLICT',409,'另一位编辑已更新批次，请刷新后继续。')
      this.store.run('INSERT INTO content_batches VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,budget=excluded.budget,status=excluded.status,payload=excluded.payload',batch.id,String(batch.profileVersion),batch.configHash,batch.cursor,JSON.stringify(batch.budget),batch.status,JSON.stringify(batch))
      this.store.run('INSERT OR IGNORE INTO occupation_profiles VALUES (?,?,?,?)',pack.profile.id,String(pack.profileVersion),JSON.stringify(pack.profile),'draft')
      for(const item of batch.items){
        if(!item.candidate)continue
        const candidate=item.candidate
        this.store.run("INSERT INTO templates VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id,version) DO UPDATE SET payload=excluded.payload,hash=excluded.hash,content_status=excluded.content_status WHERE templates.content_status IN ('draft','auto_checked')",candidate.id,String(candidate.version),'event',candidate.profileId,String(candidate.profileVersion),JSON.stringify(candidate.sourceFactIds),JSON.stringify(candidate),hash(canonical(candidate)),candidate.contentStatus,candidate.domainReviewStatus,batch.id)
      }
      this.store.audit(identity.user.id,`content.batch_${action}`,batch.id,{provider:'mock',status:batch.status,cursor:batch.cursor,tokens:batch.budget.usedTokens})
    })
  }
}
