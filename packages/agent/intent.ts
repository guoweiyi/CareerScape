import {z} from 'zod'

export const SupportedIntentSchema=z.object({kind:z.enum(['leave','help','choice','clarify','chat']),choiceId:z.string().max(80).optional(),confidence:z.number().min(0).max(1),confirmationLabel:z.string().max(160)}).strict()
export type SupportedIntent=z.infer<typeof SupportedIntentSchema>
const normalize=(text:string)=>text.trim().replace(/[。.!！?？]+$/u,'').replace(/\s+/gu,'')
/** Proposes a visible confirmation only. Calling this function cannot change the world or permissions. */
export function detectSupportedIntent(input:string,choices:{id:string;label:string}[]):SupportedIntent{
  const text=normalize(input)
  const choice=choices.find(candidate=>normalize(candidate.label)===text)
  if(choice)return {kind:'choice',choiceId:choice.id,confidence:1,confirmationLabel:`确认：${choice.label}`}
  if(['下班','我要下班','我想下班','现在下班','结束体验','我想结束体验','我想结束今天的体验','今天就到这里'].includes(text))return {kind:'leave',confidence:0.99,confirmationLabel:'确认整理交接并结束今天的体验'}
  if(['求助','我需要帮助','请帮帮我','请帮我一下','我不会做','我想请人帮忙'].includes(text))return {kind:'help',confidence:0.98,confirmationLabel:'确认向同事求助'}
  if(['继续','试试看','这样可以吗','帮我处理一下'].includes(text))return {kind:'clarify',confidence:0.35,confirmationLabel:'请说明想尝试哪一步，也可以直接选择当前行动'}
  return {kind:'chat',confidence:0,confirmationLabel:''}
}
