import { GalgameDefinitionSchema, type CareerId } from '../../../../packages/contracts/galgame'
import { galgameDefinitions, identityDescriptions } from '../../../../packages/content/galgame'
import { canonical, hash, invariant, now, type Store } from '../../../../packages/database'
import { galgameConfig } from '../../../../packages/agent/galgame'
import { checkAssets } from './content'

export class GalgameContentService {
  constructor(readonly store: Store) {}
  seed() {
    const gate = checkAssets(galgameDefinitions[0]!)
    this.store.transaction(() => {
      for (const definition of galgameDefinitions) {
        this.store.run(
          'INSERT OR IGNORE INTO packs (id,version,dataset_version,content_build_id,asset_manifest_version,manifest,checksum,status,domain_review_status,active,created_at,mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          definition.id,
          String(definition.version),
          'career-reference-v1',
          `${definition.id}-v${definition.version}`,
          definition.assetManifestVersion,
          JSON.stringify(definition),
          hash(canonical(definition)),
          gate.ok ? 'published' : 'approved',
          'pending',
          gate.ok ? 1 : 0,
          now(),
          'galgame',
        )
        if (gate.ok)
          this.store.run(
            "UPDATE packs SET status='published',active=1 WHERE id=? AND version=? AND mode='galgame' AND status='approved' AND checksum=?",
            definition.id,
            String(definition.version),
            hash(canonical(definition)),
          )
      }
    })
  }
  get(packId: string, version?: string) {
    const row = version
      ? this.store.get<{ manifest: string; checksum: string }>(
          "SELECT manifest,checksum FROM packs WHERE id=? AND version=? AND mode='galgame' AND status='published'",
          packId,
          version,
        )
      : this.store.get<{ manifest: string; checksum: string }>(
          "SELECT manifest,checksum FROM packs WHERE id=? AND mode='galgame' AND active=1 AND status='published'",
          packId,
        )
    invariant(row, 'PACK_UNAVAILABLE', 409, '这段职业故事尚未开放。')
    const definition = GalgameDefinitionSchema.parse(JSON.parse(row.manifest))
    invariant(
      hash(canonical(definition)) === row.checksum,
      'PACK_CHECKSUM',
      409,
      '职业资料版本校验失败，暂时无法开始。',
    )
    return definition
  }
  forCareer(careerId: CareerId) {
    return this.get(`gal-${careerId}-day`)
  }
  catalog() {
    const config = galgameConfig()
    const rows = this.store.all<{ manifest: string; active: number; status: string }>(
      "SELECT manifest,active,status FROM packs WHERE mode='galgame' ORDER BY active DESC,CAST(version AS INTEGER) DESC",
    )
    const seen = new Set<string>()
    return {
      available: config.available,
      identities: identityDescriptions,
      occupations: rows.flatMap((row) => {
        const d = GalgameDefinitionSchema.parse(JSON.parse(row.manifest))
        if (seen.has(d.careerId)) return []
        seen.add(d.careerId)
        return [
          {
            id: d.careerId,
            title: d.occupationTitle,
            storyTitle: d.title,
            description: d.subtitle,
            responsibilities: d.responsibilities,
            status: config.available && row.active && row.status === 'published' ? 'playable' : 'preparing',
            sourceCount: d.sources.length,
          },
        ]
      }),
    }
  }
}
