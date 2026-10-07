import {describe,it,expect} from 'vitest'
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {checkAssets} from '../apps/web/server/services/content'
import {demoPack} from '../packages/content/seed'

describe('published variant dependency gate',()=>{
  it('verifies fixed manifests including mobile assets and rejects a tampered variant',()=>{
    const directory=mkdtempSync(join(tmpdir(),'careerscape-assets-'))
    try{
      cpSync(resolve('apps/web/public/art'),resolve(directory,'public/art'),{recursive:true})
      expect(checkAssets(demoPack,directory).ok).toBe(true)
      const manifestPath=resolve(directory,`public/art/manifest-${demoPack.assetManifestVersion}.json`)
      const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {assets:{type:string;variants?:{mobile?:{id:string;sha256:string}}}[]}
      const background=manifest.assets.find(asset=>asset.type==='background')!
      const mobile=background.variants!.mobile!
      mobile.sha256='0'.repeat(64);writeFileSync(manifestPath,JSON.stringify(manifest))
      const failed=checkAssets(demoPack,directory)
      expect(failed.ok).toBe(false);expect(failed.errors.some(error=>error.includes(mobile.id))).toBe(true)
      delete background.variants!.mobile;writeFileSync(manifestPath,JSON.stringify(manifest))
      expect(checkAssets(demoPack,directory).errors.some(error=>error.includes('独立竖构图缺失'))).toBe(true)
    }finally{
      if(resolve(directory).startsWith(resolve(tmpdir(),'careerscape-assets-')))rmSync(directory,{recursive:true,force:true})
    }
  })
})
