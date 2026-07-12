import { z } from "zod";

const workCodeSchema = z
  .string()
  .trim()
  .min(2, "Informe um código com pelo menos 2 caracteres.")
  .max(32, "O código deve ter no máximo 32 caracteres.")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "Use apenas letras, números, hífen e sublinhado no código.",
  )
  .transform((value) => value.toUpperCase());

const workNameSchema = z
  .string()
  .trim()
  .min(2, "Informe um nome com pelo menos 2 caracteres.")
  .max(160, "O nome deve ter no máximo 160 caracteres.");

const workLocationSchema = z
  .string()
  .trim()
  .max(240, "O local deve ter no máximo 240 caracteres.")
  .nullable()
  .transform((value) => value || null);

export const createAdminWorkSchema = z.strictObject({
  codigo: workCodeSchema,
  nome: workNameSchema,
  local: workLocationSchema.optional(),
});

export const updateAdminWorkSchema = z
  .strictObject({
    codigo: workCodeSchema.optional(),
    nome: workNameSchema.optional(),
    local: workLocationSchema.optional(),
    ativa: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe pelo menos um campo para atualizar.",
  });

export const listAdminWorksQuerySchema = z.object({
  busca: z.string().trim().max(160).optional().default(""),
  status: z.enum(["ativas", "inativas", "todas"]).optional().default("todas"),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  porPagina: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const adminWorkIdSchema = z.uuid("Identificador da obra inválido.");

export type CreateAdminWorkInput = z.infer<typeof createAdminWorkSchema>;
export type UpdateAdminWorkInput = z.infer<typeof updateAdminWorkSchema>;
export type ListAdminWorksQuery = z.infer<typeof listAdminWorksQuerySchema>;
