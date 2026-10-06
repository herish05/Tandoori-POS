import type { AddonKind, FoodType } from '@shared/menu'

/**
 * Sample menu used to try the system out. It is never loaded automatically and never in a
 * production build: an admin has to ask for it, every row is flagged `is_demo`, and it can be
 * removed again in one step. Prices are in paise.
 */

export interface DemoStation {
  name: string
  description: string
  sortOrder: number
}

export interface DemoCategory {
  name: string
  sortOrder: number
  station: string
}

export interface DemoTax {
  name: string
  rateBps: number
}

export interface DemoAddon {
  name: string
  kind: AddonKind
  price: number
}

export interface DemoVariant {
  name: string
  price: number
  costPrice: number
  isDefault?: boolean
}

export interface DemoItem {
  name: string
  description: string
  category: string
  price: number
  costPrice: number
  foodType: FoodType
  isBestSeller?: boolean
  tax: string
  /** Names of add-ons and modifiers this item offers. */
  addons: string[]
  variants?: DemoVariant[]
}

export const DEMO_STATIONS: DemoStation[] = [
  { name: 'Tandoor', description: 'Tikkas, kebabs and breads', sortOrder: 1 },
  { name: 'Curry counter', description: 'Gravies, dal and rice', sortOrder: 2 },
  { name: 'Beverage bar', description: 'Cold drinks', sortOrder: 3 }
]

export const DEMO_CATEGORIES: DemoCategory[] = [
  { name: 'Starters', sortOrder: 1, station: 'Tandoor' },
  { name: 'Main course', sortOrder: 2, station: 'Curry counter' },
  { name: 'Breads', sortOrder: 3, station: 'Tandoor' },
  { name: 'Rice', sortOrder: 4, station: 'Curry counter' },
  { name: 'Beverages', sortOrder: 5, station: 'Beverage bar' }
]

export const DEMO_TAXES: DemoTax[] = [
  { name: 'Sample food tax 5%', rateBps: 500 },
  { name: 'Sample beverage tax 18%', rateBps: 1800 }
]

export const DEMO_ADDONS: DemoAddon[] = [
  { name: 'Extra butter', kind: 'ADDON', price: 2000 },
  { name: 'Extra cheese', kind: 'ADDON', price: 3000 },
  { name: 'Extra gravy', kind: 'ADDON', price: 3000 },
  { name: 'Less spicy', kind: 'MODIFIER', price: 0 },
  { name: 'Extra spicy', kind: 'MODIFIER', price: 0 },
  { name: 'No onion or garlic', kind: 'MODIFIER', price: 0 }
]

export const DEMO_ITEMS: DemoItem[] = [
  {
    name: 'Butter Chicken',
    description: 'Tandoori chicken in a rich tomato and butter gravy.',
    category: 'Main course',
    price: 48000,
    costPrice: 21000,
    foodType: 'NON_VEG',
    isBestSeller: true,
    tax: 'Sample food tax 5%',
    addons: ['Extra butter', 'Extra gravy', 'Less spicy', 'Extra spicy'],
    variants: [
      { name: 'Half', price: 28000, costPrice: 12000 },
      { name: 'Full', price: 48000, costPrice: 21000, isDefault: true }
    ]
  },
  {
    name: 'Paneer Tikka',
    description: 'Cottage cheese marinated in spices and grilled in the tandoor.',
    category: 'Starters',
    price: 26000,
    costPrice: 11000,
    foodType: 'VEG',
    isBestSeller: true,
    tax: 'Sample food tax 5%',
    addons: ['Extra cheese', 'Less spicy', 'No onion or garlic']
  },
  {
    name: 'Chicken Tikka',
    description: 'Boneless chicken pieces marinated and cooked in the tandoor.',
    category: 'Starters',
    price: 30000,
    costPrice: 13000,
    foodType: 'NON_VEG',
    tax: 'Sample food tax 5%',
    addons: ['Less spicy', 'Extra spicy']
  },
  {
    name: 'Butter Naan',
    description: 'Soft leavened bread brushed with butter.',
    category: 'Breads',
    price: 5500,
    costPrice: 1800,
    foodType: 'VEG',
    tax: 'Sample food tax 5%',
    addons: ['Extra butter']
  },
  {
    name: 'Dal Makhani',
    description: 'Black lentils simmered overnight with butter and cream.',
    category: 'Main course',
    price: 22000,
    costPrice: 8000,
    foodType: 'VEG',
    tax: 'Sample food tax 5%',
    addons: ['Extra butter', 'Less spicy'],
    variants: [
      { name: 'Half', price: 16000, costPrice: 6000 },
      { name: 'Full', price: 22000, costPrice: 8000, isDefault: true }
    ]
  },
  {
    name: 'Egg Curry',
    description: 'Boiled eggs in an onion and tomato masala.',
    category: 'Main course',
    price: 18000,
    costPrice: 7000,
    foodType: 'EGG',
    tax: 'Sample food tax 5%',
    addons: ['Extra gravy', 'Less spicy']
  },
  {
    name: 'Jeera Rice',
    description: 'Basmati rice tempered with cumin.',
    category: 'Rice',
    price: 16000,
    costPrice: 5000,
    foodType: 'VEG',
    tax: 'Sample food tax 5%',
    addons: []
  },
  {
    name: 'Coke',
    description: 'Chilled cola.',
    category: 'Beverages',
    price: 4000,
    costPrice: 2200,
    foodType: 'VEG',
    tax: 'Sample beverage tax 18%',
    addons: [],
    variants: [
      { name: '300 ml', price: 4000, costPrice: 2200, isDefault: true },
      { name: '600 ml', price: 6000, costPrice: 3400 }
    ]
  }
]
