import { z, ZodError } from 'zod'

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const
const VALID_TYPES = ['casual', 'full_time', 'part_time', 'contract'] as const

/**
 * Extract the first error message from a Zod validation error
 */
export function getFirstValidationError(error: ZodError): string {
  const fieldErrors = error.flatten().fieldErrors
  const firstField = Object.keys(fieldErrors)[0]
  if (firstField && Array.isArray(fieldErrors[firstField as keyof typeof fieldErrors])) {
    return (fieldErrors[firstField as keyof typeof fieldErrors] as string[])[0]
  }
  return 'Erreur de validation'
}

export const registerSchema = z.object({
  name: z.string().min(1, 'Le prénom est requis').max(100),
  email: z.string().email('Email invalide'),
  password: z.string().min(6, 'Mot de passe: 6 caractères minimum').max(100),
})

export const createJobSchema = z.object({
  title: z.string().min(1, 'Titre requis').max(200),
  company: z.string().min(1, 'Entreprise requise').max(200),
  state: z.enum(VALID_STATES, { message: 'State invalide' }),
  location: z.string().max(200).default(''),
  category: z.enum(VALID_CATEGORIES, { message: 'Catégorie invalide' }),
  type: z.enum(VALID_TYPES).default('casual'),
  pay: z.string().max(100).optional(),
  description: z.string().min(1, 'Description requise').max(10000),
  applyUrl: z.string().url().optional().or(z.literal('')),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  eligible88Days: z.boolean().default(false),
})

export const extractSchema = z.object({
  url: z.string().url('URL invalide'),
})

// Define jobQuerySchema with full state/category enums to avoid TypeScript spread issues
const QUERY_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'all'] as const
const QUERY_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other', 'all'] as const

export const jobQuerySchema = z.object({
  state: z.enum(QUERY_STATES).default('all'),
  category: z.enum(QUERY_CATEGORIES).default('all'),
  q: z.string().max(200).default(''),
  page: z.coerce.number().int().min(1).default(1),
})
