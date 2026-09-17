// Master Specification §§6–8, 13.6. No invented timings or medical instructions.
export const CATALOG_CATEGORIES = [
  { code: "pmu", label: "Перманентный макияж" }, { code: "lamination", label: "Ламинирование" },
  { code: "skin", label: "Уход за кожей" }, { code: "refresh", label: "Refresh" }, { code: "remover", label: "Remover" },
] as const;
export const CATALOG_ZONES = [
  { code: "brows", label: "Брови" }, { code: "eyes", label: "Глаза" }, { code: "lips", label: "Губы" },
  { code: "lashes", label: "Ресницы" }, { code: "skin", label: "Кожа лица" },
  { code: "cycle_zone", label: "Зона PMU определяется в цикле" },
] as const;
export const CATALOG_TECHNIQUES = [
  { code: "hair_strokes", label: "Волосковая техника" }, { code: "shading", label: "Растушёвка" },
  { code: "combo", label: "Combo" }, { code: "lashline", label: "Межресничное заполнение" },
  { code: "eyeliner", label: "Eyeliner" }, { code: "sfumato", label: "Eyeliner sfumato" },
  { code: "lip_pmu", label: "PMU губ" }, { code: "lamination", label: "Ламинирование" },
  { code: "korean", label: "Skin Experience Korean" }, { code: "extended_skin", label: "Extended Skin Experience / microneedling" },
  { code: "refresh", label: "Refresh" }, { code: "remover", label: "Remover" },
] as const;
export const CATALOG_DEFINITIONS = [
  { code: "brows-hair", name: "Брови — волосковая техника", categoryCode: "pmu", zoneCode: "brows", techniqueCode: "hair_strokes", category: "brows", procedureType: "brows", sessionsModel: "two", priceMode: "fixed", priceCents: 60000, priceMaxCents: null, durationMinutes: 120 },
  { code: "brows-shading", name: "Брови — растушёвка", categoryCode: "pmu", zoneCode: "brows", techniqueCode: "shading", category: "brows", procedureType: "brows", sessionsModel: "two", priceMode: "estimate", priceCents: 50000, priceMaxCents: null, durationMinutes: 120 },
  { code: "brows-combo", name: "Брови — combo", categoryCode: "pmu", zoneCode: "brows", techniqueCode: "combo", category: "brows", procedureType: "brows", sessionsModel: "two", priceMode: "fixed", priceCents: 55000, priceMaxCents: null, durationMinutes: 120 },
  { code: "eyes-lashline", name: "Глаза — межресничное заполнение", categoryCode: "pmu", zoneCode: "eyes", techniqueCode: "lashline", category: "eyes", procedureType: "eyes", sessionsModel: "two", priceMode: "fixed", priceCents: 35000, priceMaxCents: null, durationMinutes: 120 },
  { code: "eyes-eyeliner", name: "Глаза — eyeliner", categoryCode: "pmu", zoneCode: "eyes", techniqueCode: "eyeliner", category: "eyes", procedureType: "eyes", sessionsModel: "two", priceMode: "range", priceCents: 45000, priceMaxCents: 50000, durationMinutes: 120 },
  { code: "eyes-sfumato", name: "Глаза — eyeliner sfumato", categoryCode: "pmu", zoneCode: "eyes", techniqueCode: "sfumato", category: "eyes", procedureType: "eyes", sessionsModel: "two", priceMode: "fixed", priceCents: 55000, priceMaxCents: null, durationMinutes: 120 },
  { code: "lips", name: "Губы — PMU", categoryCode: "pmu", zoneCode: "lips", techniqueCode: "lip_pmu", category: "lips", procedureType: "lips", sessionsModel: "two", priceMode: "range", priceCents: 50000, priceMaxCents: 55000, durationMinutes: 120 },
  { code: "lash-lamination", name: "Laminazione ciglia", categoryCode: "lamination", zoneCode: "lashes", techniqueCode: "lamination", category: "lamination", procedureType: "lamination", sessionsModel: "one", priceMode: "fixed", priceCents: 6000, priceMaxCents: null, durationMinutes: null },
  { code: "brow-lamination", name: "Laminazione sopracciglia", categoryCode: "lamination", zoneCode: "brows", techniqueCode: "lamination", category: "lamination", procedureType: "lamination", sessionsModel: "one", priceMode: "fixed", priceCents: 6000, priceMaxCents: null, durationMinutes: null },
  { code: "skin-korean", name: "Skin Experience Korean", categoryCode: "skin", zoneCode: "skin", techniqueCode: "korean", category: "skin", procedureType: "facial", sessionsModel: "one", priceMode: "fixed", priceCents: 12000, priceMaxCents: null, durationMinutes: null },
  { code: "skin-extended", name: "Extended Skin Experience / microneedling", categoryCode: "skin", zoneCode: "skin", techniqueCode: "extended_skin", category: "skin", procedureType: "facial", sessionsModel: "one", priceMode: "fixed", priceCents: 15000, priceMaxCents: null, durationMinutes: null },
  { code: "refresh", name: "Refresh", categoryCode: "refresh", zoneCode: "cycle_zone", techniqueCode: "refresh", category: "refresh", procedureType: "refresh", sessionsModel: "one", priceMode: "fixed", priceCents: 35000, priceMaxCents: null, durationMinutes: 60 },
  { code: "remover", name: "Remover", categoryCode: "remover", zoneCode: "cycle_zone", techniqueCode: "remover", category: "remover", procedureType: "remover", sessionsModel: "variable", priceMode: "fixed", priceCents: 10000, priceMaxCents: null, durationMinutes: 60 },
] as const;
export const SESSION_LABELS: Record<string, string> = { one: "1 сессия", two: "2 сессии", variable: "Количество определяется по ходу лечения" };
