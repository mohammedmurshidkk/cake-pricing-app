import {DesignElement, FlavorPricing} from '../types';

let nextId = 1;
const id = () => String(nextId++);

export const DEFAULT_DESIGN_ELEMENTS: DesignElement[] = [
  {id: id(), element_key: 'extra_tier', element_label: 'Extra Tier', price: 500, price_type: 'fixed', is_active: true, sort_order: 0},
  {id: id(), element_key: 'fondant_covering', element_label: 'Fondant Covering', price: 300, price_type: 'fixed', is_active: true, sort_order: 1},
  {id: id(), element_key: 'buttercream_finish', element_label: 'Buttercream Finish', price: 0, price_type: 'fixed', is_active: true, sort_order: 2},
  {id: id(), element_key: 'fondant_bow', element_label: 'Fondant Bow', price: 100, price_type: 'fixed', is_active: true, sort_order: 3},
  {id: id(), element_key: 'crown_topper', element_label: 'Crown/Tiara Topper', price: 150, price_type: 'fixed', is_active: true, sort_order: 4},
  {id: id(), element_key: 'doll_topper', element_label: 'Doll/Figurine Topper', price: 250, price_type: 'fixed', is_active: true, sort_order: 5},
  {id: id(), element_key: 'number_topper', element_label: 'Number Topper', price: 80, price_type: 'fixed', is_active: true, sort_order: 6},
  {id: id(), element_key: 'name_letters', element_label: 'Name Letters', price: 30, price_type: 'per_unit', is_active: true, sort_order: 7},
  {id: id(), element_key: 'decorative_spheres', element_label: 'Decorative Spheres/Balls', price: 100, price_type: 'fixed', is_active: true, sort_order: 8},
  {id: id(), element_key: 'edible_print', element_label: 'Edible Print', price: 200, price_type: 'fixed', is_active: true, sort_order: 9},
  {id: id(), element_key: 'hand_painted', element_label: 'Hand-Painted Details', price: 400, price_type: 'fixed', is_active: true, sort_order: 10},
  {id: id(), element_key: 'quilted_pattern', element_label: 'Quilted/Textured Pattern', price: 200, price_type: 'fixed', is_active: true, sort_order: 11},
  {id: id(), element_key: 'gold_accents', element_label: 'Gold Accents', price: 150, price_type: 'fixed', is_active: true, sort_order: 12},
  {id: id(), element_key: 'silver_accents', element_label: 'Silver Accents', price: 150, price_type: 'fixed', is_active: true, sort_order: 13},
  {id: id(), element_key: 'fresh_flowers', element_label: 'Fresh Flowers', price: 300, price_type: 'fixed', is_active: true, sort_order: 14},
  {id: id(), element_key: 'chocolate_drizzle', element_label: 'Chocolate Drizzle', price: 100, price_type: 'fixed', is_active: true, sort_order: 15},
  {id: id(), element_key: 'macarons', element_label: 'Macarons', price: 50, price_type: 'per_unit', is_active: true, sort_order: 16},
  {id: id(), element_key: 'meringue_kisses', element_label: 'Meringue Kisses', price: 30, price_type: 'per_unit', is_active: true, sort_order: 17},
  {id: id(), element_key: 'butterfly_decor', element_label: 'Butterfly Decorations', price: 80, price_type: 'fixed', is_active: true, sort_order: 18},
  {id: id(), element_key: 'theme_decorations', element_label: 'Theme Decorations', price: 200, price_type: 'fixed', is_active: true, sort_order: 19},
];

export const DEFAULT_FLAVORS: FlavorPricing[] = [
  {
    id: '101',
    flavor_name: 'Vanilla',
    sizes: [
      {name: '500g', price: 450, is_base: false},
      {name: '1kg', price: 900, is_base: true},
      {name: '2kg', price: 1800, is_base: false},
    ],
    is_active: true,
  },
  {
    id: '102',
    flavor_name: 'Chocolate',
    sizes: [
      {name: '500g', price: 500, is_base: false},
      {name: '1kg', price: 1000, is_base: true},
      {name: '2kg', price: 2000, is_base: false},
    ],
    is_active: true,
  },
  {
    id: '103',
    flavor_name: 'Red Velvet',
    sizes: [
      {name: '500g', price: 550, is_base: false},
      {name: '1kg', price: 1100, is_base: true},
      {name: '2kg', price: 2200, is_base: false},
    ],
    is_active: true,
  },
  {
    id: '104',
    flavor_name: 'Butterscotch',
    sizes: [
      {name: '500g', price: 475, is_base: false},
      {name: '1kg', price: 950, is_base: true},
      {name: '2kg', price: 1900, is_base: false},
    ],
    is_active: true,
  },
  {
    id: '105',
    flavor_name: 'Black Forest',
    sizes: [
      {name: '500g', price: 500, is_base: false},
      {name: '1kg', price: 1000, is_base: true},
      {name: '2kg', price: 2000, is_base: false},
    ],
    is_active: true,
  },
];
