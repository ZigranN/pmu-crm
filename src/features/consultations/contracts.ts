import { z } from "zod";
export const OUTCOMES=["can_proceed","removal_required","temporarily_unavailable","master_cannot_help","client_thinking"] as const;
export const OUTCOME_LABELS:Record<typeof OUTCOMES[number],string>={can_proceed:"Можно продолжить",removal_required:"Требуется Remover",temporarily_unavailable:"Временно невозможно",master_cannot_help:"Мастер не может помочь",client_thinking:"Клиент думает"};
export const qualificationSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),otherMasterPmu:z.boolean(),doubt:z.boolean(),conditionChanged:z.boolean(),evaluationRequired:z.boolean(),reason:z.string().trim().min(3).max(1000)}).strict();
export const completionSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),appointmentId:z.string().uuid(),reason:z.string().trim().min(3).max(1000)}).strict();
export const resultSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),consultationId:z.string().uuid(),outcome:z.enum(OUTCOMES),reason:z.string().trim().min(3).max(1000),comment:z.string().trim().max(2000).default(""),reassessmentAt:z.string().datetime({offset:true}).nullable().default(null)}).strict().superRefine((value,ctx)=>{
  if(value.outcome==="temporarily_unavailable"&&(!value.reassessmentAt||!value.comment))ctx.addIssue({code:"custom",message:"Нужны дата повторной оценки и комментарий"});
  if(value.outcome!=="temporarily_unavailable"&&value.reassessmentAt)ctx.addIssue({code:"custom",message:"Дата повторной оценки относится только к временной недоступности"});
});

export const rescheduleFollowUpSchema=z.object({id:z.string().uuid(),resultId:z.string().uuid(),expectedVersion:z.number().int().positive(),dueAt:z.string().datetime({offset:true}),reason:z.string().trim().min(3).max(1000),comment:z.string().trim().min(1).max(2000)}).strict();

export const cycleReviewSchema=z.discriminatedUnion("operation",[
 z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),operation:z.literal("reassess"),reason:z.string().trim().min(3).max(1000),comment:z.string().trim().min(1).max(2000),otherMasterPmu:z.boolean(),doubt:z.boolean(),conditionChanged:z.boolean(),evaluationRequired:z.boolean()}).strict(),
 z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),operation:z.literal("lost"),reason:z.string().trim().min(3).max(1000),comment:z.string().trim().min(1).max(2000)}).strict(),
]);
