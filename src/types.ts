export interface FlavorSize {
  name: string;      // e.g. "500g", "1kg"
  price: number;     // e.g. 600, 1000
  is_base: boolean;  // true for the anchor size used in proportional calculation
}

export interface FlavorPricing {
  id: string;
  flavor_name: string;
  sizes: FlavorSize[];
  is_active: boolean;
}

export interface DesignElement {
  id: string;
  element_key: string;       // e.g. "fondant_covering"
  element_label: string;     // e.g. "Fondant Covering"
  price: number;             // e.g. 300
  price_type: 'fixed' | 'per_unit';
  is_active: boolean;
  sort_order: number;
}

export interface DetectedElement {
  element_key: string;
  element_label: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  confidence: number;
}

export interface CakeAnalysisResult {
  detected_elements: DetectedElement[];
  detected_flavor: string;
  detected_weight_grams: number;
  complexity_level: 'simple' | 'moderate' | 'elaborate' | 'premium';
  complexity_reasoning: string;
  price_breakdown: {
    base_price: number;
    design_elements_total: number;
    grand_total: number;
  };
  confidence_score: number;
  suggested_message: string;
  warnings: string[];
}

export interface SupabaseConfig {
  url: string;
  anon_key: string;
  business_id: string;
  auto_save_quotes: boolean;
}

export interface AppConfig {
  gemini_api_key: string;
  supabase: SupabaseConfig;
  flavors: FlavorPricing[];
  design_elements: DesignElement[];
}

/** A single element within a SavedCakeDesign — key + quantity only, no price. */
export interface SavedDesignElement {
  element_key: string;
  element_label: string;
  quantity: number;
  /** Unit price at the time of saving. Used only as a fallback when the master
   * element in Settings → Elements has no price set (0) — otherwise the fresh
   * master price always wins, so normal price updates still take effect. */
  unit_price?: number;
}

/**
 * A reusable cake design "recipe" the user saves after an AI analysis, so it
 * can be re-checked later without re-running AI detection (which can vary
 * between runs). Deliberately carries no price — price_type/price for each
 * element_key always come fresh from AppConfig.design_elements at load time.
 */
export interface SavedCakeDesign {
  id?: string;
  business_id: string;
  name: string;
  flavor_name?: string | null;
  weight_grams?: number | null;
  elements: SavedDesignElement[];
  /** dHash (16 hex chars) of the source photo, for "looks like a saved design" matching. */
  image_phash?: string | null;
  /** The original uploaded photo, so reopening a saved design shows the same image. Read-only — not re-editable from the reloaded screen. */
  image_base64?: string | null;
  image_mime_type?: string | null;
  created_at?: string;
}

export interface SavedCakeQuote {
  id?: string;
  business_id: string;
  customer_weight?: string;
  customer_flavor?: string;
  ai_analysis: CakeAnalysisResult;
  suggested_price: number;
  suggested_message: string;
  status: 'pending' | 'sent' | 'cancelled' | 'expired';
  created_at?: string;
}

export type Screen = 'home' | 'calculate' | 'result' | 'settings' | 'saved-designs';
