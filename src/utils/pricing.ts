import {
  FlavorPricing,
  DetectedElement,
  DesignElement,
  SavedCakeDesign,
  AppConfig,
  CakeAnalysisResult,
} from '../types';

/**
 * Parse weight strings like "1kg", "500g", "half kg" into grams.
 */
export function parseWeight(weightStr: string): number {
  const norm = weightStr.toLowerCase().trim();
  const kg = norm.match(/(\d+(?:\.\d+)?)\s*kg/);
  if (kg) {
    return Math.round(parseFloat(kg[1]) * 1000);
  }
  const g = norm.match(/(\d+)\s*g(?:rams?)?/);
  if (g) {
    return parseInt(g[1], 10);
  }
  if (norm.includes('half kg') || norm.includes('half kilo')) {
    return 500;
  }
  if (norm.includes('quarter kg') || norm.includes('quarter kilo')) {
    return 250;
  }
  return 1000; // default 1kg
}

/**
 * Format grams to human-readable weight string.
 */
export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kg = grams / 1000;
    return kg % 1 === 0 ? `${kg}kg` : `${kg.toFixed(1)}kg`;
  }
  return `${grams}g`;
}

/**
 * Calculate base price for a flavor at a given weight.
 * 1. Exact size match → use that price directly
 * 2. Proportional from is_base size → (basePrice / baseGrams) * requestedGrams
 * 3. Fallback to first size
 */
export function calculateBasePrice(
  flavor: FlavorPricing,
  weightGrams: number,
): number {
  if (!flavor || !flavor.sizes || flavor.sizes.length === 0) {
    return 0;
  }

  // 1. Exact match
  for (const size of flavor.sizes) {
    if (parseWeight(size.name) === weightGrams) {
      return size.price;
    }
  }

  // 2. Proportional from base size
  const baseSize = flavor.sizes.find(s => s.is_base);
  if (baseSize) {
    const baseGrams = parseWeight(baseSize.name);
    if (baseGrams > 0) {
      return Math.round((baseSize.price / baseGrams) * weightGrams);
    }
  }

  // 3. Fallback: first size
  const first = flavor.sizes[0];
  const firstGrams = parseWeight(first.name);
  if (firstGrams > 0) {
    return Math.round((first.price / firstGrams) * weightGrams);
  }

  return 0;
}

/**
 * Re-price AI-detected elements using the local design element config.
 * Ensures unit_price matches the configured price, not AI hallucination.
 */
export function repriceElements(
  detected: DetectedElement[],
  configElements: DesignElement[],
): DetectedElement[] {
  const byKey = new Map(configElements.map(e => [e.element_key, e]));
  return detected.map(el => {
    const known = byKey.get(el.element_key);
    if (known) {
      const unitPrice = known.price;
      const totalPrice =
        known.price_type === 'per_unit'
          ? unitPrice * Math.max(1, Math.round(el.quantity))
          : unitPrice;
      return {...el, unit_price: unitPrice, total_price: totalPrice};
    }
    return el;
  });
}

/**
 * Rebuild a CakeAnalysisResult from a saved design + the CURRENT config,
 * skipping AI detection entirely. This is what makes re-checking a saved
 * cake give a stable price: the element composition (keys + quantities) is
 * frozen at save time, but price always comes fresh from config.design_elements
 * and config.flavors — never from a previous AI run or a stored price.
 */
export function buildAnalysisFromSavedDesign(
  design: SavedCakeDesign,
  config: AppConfig,
): CakeAnalysisResult {
  const weightGrams = design.weight_grams || 1000;
  const flavor = config.flavors.find(
    f => f.flavor_name.toLowerCase() === (design.flavor_name || '').toLowerCase(),
  );
  const basePrice = flavor ? calculateBasePrice(flavor, weightGrams) : 0;

  const byKey = new Map(config.design_elements.map(e => [e.element_key, e]));
  const detected_elements: DetectedElement[] = design.elements.map(el => {
    const known = byKey.get(el.element_key);
    const masterPrice = known?.price ?? 0;
    // Master rate wins when it's actually set; otherwise fall back to the
    // price captured at save time (e.g. an element priced 0 in Settings that
    // was manually priced per-cake) instead of silently showing ₹0.
    const unitPrice = masterPrice > 0 ? masterPrice : el.unit_price ?? 0;
    const qty = Math.max(1, Math.round(el.quantity));
    const totalPrice = known?.price_type === 'per_unit' ? unitPrice * qty : unitPrice;
    return {
      element_key: el.element_key,
      element_label: known?.element_label || el.element_label,
      quantity: qty,
      unit_price: unitPrice,
      total_price: totalPrice,
      confidence: 1,
    };
  });

  const design_elements_total = detected_elements.reduce((s, e) => s + e.total_price, 0);

  return {
    detected_elements,
    detected_flavor: flavor?.flavor_name || design.flavor_name || '',
    detected_weight_grams: weightGrams,
    complexity_level: 'moderate',
    complexity_reasoning: `Reloaded from saved design "${design.name}" — elements and quantities are fixed from the save, prices recalculated from current master rates.`,
    price_breakdown: {
      base_price: basePrice,
      design_elements_total,
      grand_total: basePrice + design_elements_total,
    },
    confidence_score: 1,
    suggested_message: '',
    warnings: findMissingElementWarnings(design, byKey),
  };
}

function findMissingElementWarnings(design: SavedCakeDesign, byKey: Map<string, DesignElement>): string[] {
  const missing = design.elements
    .filter(el => !byKey.has(el.element_key))
    .map(el => el.element_label || el.element_key);
  return missing.length > 0
    ? [`These saved elements no longer exist in Settings → Elements and were priced at ₹0: ${missing.join(', ')}`]
    : [];
}

/**
 * Calculate grand total from base price + design elements.
 */
export function calculateTotal(
  basePrice: number,
  elements: DetectedElement[],
): number {
  const elementsTotal = elements.reduce((sum, el) => sum + el.total_price, 0);
  return basePrice + elementsTotal;
}
