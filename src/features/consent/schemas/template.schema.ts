import { z } from "zod";

export const createConsentTemplateSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "Template code is required")
      .max(100, "Template code must not exceed 100 characters"),
    name: z
      .string()
      .trim()
      .min(1, "Template name is required")
      .max(255, "Template name must not exceed 255 characters"),
    description: z
      .string()
      .trim()
      .max(2000, "Description must not exceed 2000 characters")
      .nullable()
      .optional(),
  })
  .strict();

export type CreateConsentTemplateInput = z.infer<typeof createConsentTemplateSchema>;

export const createConsentTemplateDraftVersionSchema = z
  .object({
    templateId: z.string().uuid("Invalid template ID"),
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(255, "Title must not exceed 255 characters"),
    body: z
      .string()
      .trim()
      .min(1, "Body is required")
      .max(100000, "Body must not exceed 100000 characters"),
  })
  .strict();

export type CreateConsentTemplateDraftVersionInput = z.infer<
  typeof createConsentTemplateDraftVersionSchema
>;

export const updateConsentTemplateDraftVersionSchema = z
  .object({
    versionId: z.string().uuid("Invalid version ID"),
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(255, "Title must not exceed 255 characters"),
    body: z
      .string()
      .trim()
      .min(1, "Body is required")
      .max(100000, "Body must not exceed 100000 characters"),
  })
  .strict();

export type UpdateConsentTemplateDraftVersionInput = z.infer<
  typeof updateConsentTemplateDraftVersionSchema
>;

export const publishConsentTemplateVersionSchema = z
  .object({
    versionId: z.string().uuid("Invalid version ID"),
  })
  .strict();

export type PublishConsentTemplateVersionInput = z.infer<
  typeof publishConsentTemplateVersionSchema
>;

export const archiveConsentTemplateSchema = z
  .object({
    templateId: z.string().uuid("Invalid template ID"),
  })
  .strict();

export type ArchiveConsentTemplateInput = z.infer<
  typeof archiveConsentTemplateSchema
>;
