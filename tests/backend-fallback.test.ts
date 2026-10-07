import {describe,it,expect} from 'vitest'
import {Store,hash,canonical} from '../packages/database'
import {AuthService} from '../apps/web/server/services/auth'
import {ContentService} from '../apps/web/server/services/content'
import {GameService} from '../apps/web/server/services/game'
import {demoPack} from '../packages/content/seed'
import {legacyPack} from '../packages/content/seed-v1'

function setup(){const store=new Store(':memory:');const content=new ContentService(store);content.seed();const auth=new AuthService(store),guest=auth.guest(),identity=auth.lookup('raw' in guest?guest.raw:undefined)!;identity.user.roles=['editor','reviewer','admin'];return{store,content,identity,game:new GameService(store)}}
describe('publication and creation assembly gates',()=>{
  it('rejects valid JSON graphs whose event pool cannot fill the six required slots',()=>{
    const {store,content,identity}=setup()
    try{
      const cloned=content.mutate(identity,{action:'clone',packId:demoPack.id,version:demoPack.version})
      const pack=content.get(cloned.id,cloned.version);for(const event of pack.events)event.slot='arrival'
      content.mutate(identity,{action:'save',packId:cloned.id,version:cloned.version,pack})
      expect(()=>content.mutate(identity,{action:'check',packId:cloned.id,version:cloned.version})).toThrow(expect.objectContaining({code:'ASSEMBLY_GATE'}))
      store.run("UPDATE packs SET status='approved' WHERE id=? AND version=?",cloned.id,String(cloned.version))
      expect(()=>content.mutate(identity,{action:'publish',packId:cloned.id,version:cloned.version})).toThrow(expect.objectContaining({code:'ASSEMBLY_GATE'}))
      expect(content.get(demoPack.id).version).toBe(demoPack.version)
    }finally{store.close()}
  })
  it('uses only the checksum-pinned published legacy package before creating a fallback instance',()=>{
    const {store,game,identity}=setup()
    try{
      const old=game.create(identity.user.id,{packId:demoPack.id,seed:'original-route'})
      const broken=structuredClone(demoPack);for(const event of broken.events)event.slot='arrival'
      store.run('UPDATE packs SET manifest=?,checksum=? WHERE id=? AND version=?',JSON.stringify(broken),hash(canonical(broken)),broken.id,String(broken.version))
      const fallback=game.create(identity.user.id,{packId:demoPack.id,seed:'requested-route'})
      expect(fallback.packVersion).toBe(legacyPack.version);expect(fallback.assetManifestVersion).toBe(legacyPack.assetManifestVersion)
      expect(fallback.instance.fallback).toBe(true);expect(fallback.instance.seed).toBe('fixed-safe-v1')
      expect(fallback.assemblyFallback).toMatchObject({fromPackVersion:demoPack.version,toPackVersion:legacyPack.version,requestedSeed:'requested-route'})
      expect(game.get(identity.user.id,old.id).packVersion).toBe(demoPack.version)
      const count=store.get<{n:number}>('SELECT COUNT(*) n FROM sessions')!.n
      store.run("UPDATE packs SET checksum=? WHERE id=? AND version=?",'0'.repeat(64),legacyPack.id,String(legacyPack.version))
      expect(()=>game.create(identity.user.id,{packId:demoPack.id})).toThrow(expect.objectContaining({code:'ASSEMBLY_UNAVAILABLE'}))
      expect(store.get<{n:number}>('SELECT COUNT(*) n FROM sessions')!.n).toBe(count)
    }finally{store.close()}
  })
})
