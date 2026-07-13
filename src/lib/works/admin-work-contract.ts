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
  .refine((value) => !value || /^.+\s-\s[A-Za-z]{2}$/.test(value), {
    message: "Informe o local no formato Cidade - UF.",
  })
  .transform((value) => {
    if (!value) return null;
    const separator = value.lastIndexOf(" - ");
    return `${value.slice(0, separator)} - ${value.slice(separator + 3).toUpperCase()}`;
  });

const responsibleProfileIdSchema = z.uuid(
  "Selecione um responsável válido.",
);

export const createAdminWorkSchema = z.strictObject({
  codigo: workCodeSchema,
  nome: workNameSchema,
  local: workLocationSchema.optional(),
  responsavelId: responsibleProfileIdSchema,
  ativa: z.boolean().optional().default(true),
});

export const updateAdminWorkSchema = z
  .strictObject({
    codigo: workCodeSchema.optional(),
    nome: workNameSchema.optional(),
    local: workLocationSchema.optional(),
    responsavelId: responsibleProfileIdSchema.nullable().optional(),
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

export const adminWorkImportRequestSchema = z.strictObject({
  modo: z.enum(["validar", "aplicar"]),
  csv: z.string().min(1, "Selecione um arquivo CSV preenchido.").max(2_000_000),
});

export type CreateAdminWorkInput = z.infer<typeof createAdminWorkSchema>;
export type UpdateAdminWorkInput = z.infer<typeof updateAdminWorkSchema>;
export type ListAdminWorksQuery = z.infer<typeof listAdminWorksQuerySchema>;
export type AdminWorkImportRequest = z.infer<
  typeof adminWorkImportRequestSchema
>;
