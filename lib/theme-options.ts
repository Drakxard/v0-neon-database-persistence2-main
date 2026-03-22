export const APP_THEMES = [
  {
    id: "daylight",
    label: "Daylight",
    description: "Claro neutro con aire azul.",
    swatchClassName: "from-slate-50 via-white to-sky-100",
  },
  {
    id: "sand",
    label: "Sand",
    description: "Claro calido con tonos arena.",
    swatchClassName: "from-stone-100 via-amber-50 to-orange-100",
  },
  {
    id: "mist",
    label: "Mist",
    description: "Frio suave y desaturado.",
    swatchClassName: "from-slate-100 via-teal-50 to-sky-100",
  },
  {
    id: "night",
    label: "Night",
    description: "Oscuro elegante sin negro puro.",
    swatchClassName: "from-slate-800 via-slate-700 to-indigo-700",
  },
] as const

export type AppTheme = (typeof APP_THEMES)[number]["id"]

export function isAppTheme(value: string | undefined | null): value is AppTheme {
  return APP_THEMES.some((theme) => theme.id === value)
}

export function isNightTheme(value: string | undefined | null) {
  return value === "night"
}
