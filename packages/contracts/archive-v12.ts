import { z } from 'zod'
import { SaveArchiveSchema } from './archive'
import {
  GalgameActionSchema,
  GalgameGenerationSchema,
  GalgameMessageSchema,
  PlayerProfileSchema,
} from './galgame'

const key = z.string().min(1).max(100)
export const GalgameArchivedInstanceSchema = z
  .object({
    branch_id: key,
    session_id: key,
    seed: z.string().min(1).max(80),
    player: z
      .string()
      .max(4000)
      .refine((text) => {
        try {
          return PlayerProfileSchema.safeParse(JSON.parse(text)).success
        } catch {
          return false
        }
      }, '人物设定无效'),
    begin_action_id: z.string().min(8).max(80),
    prompt_version: key,
  })
  .strict()
export const GalgameEventPayloadSchema = z
  .object({
    messages: z.array(GalgameMessageSchema).max(5),
    revision: z.number().int().nonnegative(),
    instance: GalgameArchivedInstanceSchema.optional(),
    action: GalgameActionSchema.optional(),
    generation: GalgameGenerationSchema.optional(),
  })
  .strict()
export const SaveArchiveV12Schema = SaveArchiveSchema.extend({
  schemaVersion: z.literal('1.2'),
  sessions: z
    .array(SaveArchiveSchema.shape.sessions.element.extend({ mode: z.enum(['story', 'galgame']) }))
    .max(50),
  branches: SaveArchiveSchema.shape.branches.max(2500),
  galgameInstances: z.array(GalgameArchivedInstanceSchema).max(2500),
  events: z
    .array(
      SaveArchiveSchema.shape.events.element.extend({
        kind: z.enum([
          'session_started',
          'choice',
          'message',
          'explain',
          'leave',
          'switch_role',
          'begin',
          'act',
          'submit_artifact',
          'debrief',
        ]),
      }),
    )
    .max(100000),
  snapshots: SaveArchiveSchema.shape.snapshots.max(102500),
  journals: SaveArchiveSchema.shape.journals.max(2500),
}).strict()
export type SaveArchiveV12 = z.infer<typeof SaveArchiveV12Schema>
