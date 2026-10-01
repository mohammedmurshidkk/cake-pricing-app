import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConfig, FlavorPricing, DesignElement, CakeAnalysisResult, SavedCakeDesign } from '../types';

let supabaseClientInstance: SupabaseClient | null = null;
let currentClientKey: string = '';

export function getSupabaseClient(config: SupabaseConfig): SupabaseClient | null {
  if (!config.url || !config.anon_key) {
    return null;
  }
  const cleanUrl = config.url.trim().replace(/\/+$/, '');
  const cleanKey = config.anon_key.trim();
  const key = `${cleanUrl}_${cleanKey}`;
  if (!supabaseClientInstance || currentClientKey !== key) {
    supabaseClientInstance = createClient(cleanUrl, cleanKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    currentClientKey = key;
  }
  return supabaseClientInstance;
}

function requireClient(config: SupabaseConfig): SupabaseClient {
  const client = getSupabaseClient(config);
  if (!client) {
    throw new Error('Supabase URL and Anon Key are not configured.');
  }
  return client;
}

function mapFlavor(item: any): FlavorPricing {
  return {
    id: item.id,
    flavor_name: item.flavor_name,
    sizes: Array.isArray(item.sizes) ? item.sizes : [],
    is_active: item.is_active ?? true,
  };
}

function mapElement(item: any): DesignElement {
  return {
    id: item.id,
    element_key: item.element_key,
    element_label: item.element_label,
    price: Number(item.price) || 0,
    price_type: item.price_type === 'per_unit' ? 'per_unit' : 'fixed',
    is_active: item.is_active ?? true,
    sort_order: item.sort_order || 0,
  };
}

// ─── FLAVORS ─────────────────────────────────────────────────

/**
 * Fetch all active flavors for this business from Supabase.
 * This is the single source of truth — no local fallback.
 */
export async function fetchFlavorsFromSupabase(config: SupabaseConfig): Promise<FlavorPricing[]> {
  const supabase = requireClient(config);

  let query = supabase
    .from('cake_flavor_pricing')
    .select('*')
    .eq('is_active', true)
    .order('flavor_name', { ascending: true });

  if (config.business_id?.trim()) {
    query = query.eq('business_id', config.business_id.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch flavors: ${error.message}`);
  return (data || []).map(mapFlavor);
}

/**
 * Insert a new flavor into Supabase.
 * Returns the saved record with the DB-generated UUID id.
 */
export async function insertFlavorToSupabase(
  config: SupabaseConfig,
  flavor: Omit<FlavorPricing, 'id'>,
): Promise<FlavorPricing> {
  const supabase = requireClient(config);

  const row: Record<string, any> = {
    flavor_name: flavor.flavor_name,
    sizes: flavor.sizes,
    is_active: flavor.is_active,
  };
  if (config.business_id?.trim()) {
    row.business_id = config.business_id.trim();
  }

  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to add flavor: ${error.message}`);
  return mapFlavor(data);
}

/**
 * Update an existing flavor in Supabase by its id.
 * Returns the updated record.
 */
export async function updateFlavorInSupabase(
  config: SupabaseConfig,
  flavor: FlavorPricing,
): Promise<FlavorPricing> {
  const supabase = requireClient(config);

  const { data, error } = await supabase
    .from('cake_flavor_pricing')
    .update({
      flavor_name: flavor.flavor_name,
      sizes: flavor.sizes,
      is_active: flavor.is_active,
    })
    .eq('id', flavor.id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update flavor: ${error.message}`);
  return mapFlavor(data);
}

/**
 * Hard-delete a flavor from Supabase by id.
 * Supabase is the truth — deleted here means deleted everywhere.
 */
export async function deleteFlavorFromSupabase(
  config: SupabaseConfig,
  id: string,
): Promise<void> {
  const supabase = requireClient(config);
  const { error } = await supabase
    .from('cake_flavor_pricing')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`Failed to delete flavor: ${error.message}`);
}

// ─── DESIGN ELEMENTS ─────────────────────────────────────────

/**
 * Fetch all active design elements for this business from Supabase.
 */
export async function fetchDesignElementsFromSupabase(config: SupabaseConfig): Promise<DesignElement[]> {
  const supabase = requireClient(config);

  let query = supabase
    .from('cake_design_elements')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (config.business_id?.trim()) {
    query = query.eq('business_id', config.business_id.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch design elements: ${error.message}`);
  return (data || []).map(mapElement);
}

/**
 * Insert a new design element into Supabase.
 * Returns the saved record with the DB-generated UUID id.
 */
export async function insertElementToSupabase(
  config: SupabaseConfig,
  element: Omit<DesignElement, 'id'>,
): Promise<DesignElement> {
  const supabase = requireClient(config);

  const row: Record<string, any> = {
    element_key: element.element_key,
    element_label: element.element_label,
    price: element.price,
    price_type: element.price_type,
    is_active: element.is_active,
    sort_order: element.sort_order,
  };
  if (config.business_id?.trim()) {
    row.business_id = config.business_id.trim();
  }

  const { data, error } = await supabase
    .from('cake_design_elements')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to add element: ${error.message}`);
  return mapElement(data);
}

/**
 * Update an existing design element in Supabase by its id.
 * Returns the updated record.
 */
export async function updateElementInSupabase(
  config: SupabaseConfig,
  element: DesignElement,
): Promise<DesignElement> {
  const supabase = requireClient(config);

  const { data, error } = await supabase
    .from('cake_design_elements')
    .update({
      element_key: element.element_key,
      element_label: element.element_label,
      price: element.price,
      price_type: element.price_type,
      is_active: element.is_active,
      sort_order: element.sort_order,
    })
    .eq('id', element.id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update element: ${error.message}`);
  return mapElement(data);
}

/**
 * Hard-delete a design element from Supabase by id.
 */
export async function deleteElementFromSupabase(
  config: SupabaseConfig,
  id: string,
): Promise<void> {
  const supabase = requireClient(config);
  const { error } = await supabase
    .from('cake_design_elements')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`Failed to delete element: ${error.message}`);
}

// ─── QUOTES ──────────────────────────────────────────────────

/**
 * Save a calculated cake price quote to Supabase. If `id` is provided, updates
 * that existing row (so edits after the first save overwrite it instead of
 * creating a duplicate); otherwise inserts a new row.
 * Table: cake_price_quotes
 */
export async function saveQuoteToSupabase(
  config: SupabaseConfig,
  analysis: CakeAnalysisResult,
  imageUrl?: string | null,
  id?: string | null,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = getSupabaseClient(config);
  if (!supabase || !config.business_id?.trim()) {
    return { success: false, error: 'Supabase business_id not configured' };
  }

  const row = {
    business_id: config.business_id.trim(),
    image_url: imageUrl || null,
    customer_weight: analysis.detected_weight_grams ? `${analysis.detected_weight_grams}g` : '1kg',
    customer_flavor: analysis.detected_flavor || 'Default',
    ai_analysis: analysis,
    suggested_price: analysis.price_breakdown.grand_total,
    suggested_message: analysis.suggested_message,
  };

  try {
    const { data, error } = id
      ? await supabase
          .from('cake_price_quotes')
          .update(row)
          .eq('id', id)
          .select('id')
          .single()
      : await supabase
          .from('cake_price_quotes')
          .insert({ ...row, status: 'pending', created_at: new Date().toISOString() })
          .select('id')
          .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown save error' };
  }
}

// ─── SAVED DESIGNS ───────────────────────────────────────────
// Reusable cake "recipes" (element_key + quantity only, no price) that let
// the user re-check a design's price later without re-running AI detection.

function mapSavedDesign(item: any): SavedCakeDesign {
  return {
    id: item.id,
    business_id: item.business_id,
    name: item.name,
    flavor_name: item.flavor_name,
    weight_grams: item.weight_grams,
    elements: Array.isArray(item.elements) ? item.elements : [],
    image_phash: item.image_phash || null,
    image_base64: item.image_base64 || null,
    image_mime_type: item.image_mime_type || null,
    created_at: item.created_at,
  };
}

/**
 * Fetch all saved cake designs for this business from Supabase.
 * Table: cake_saved_designs
 */
export async function fetchSavedCakeDesigns(config: SupabaseConfig): Promise<SavedCakeDesign[]> {
  const supabase = requireClient(config);

  let query = supabase
    .from('cake_saved_designs')
    .select('*')
    .order('created_at', { ascending: false });

  if (config.business_id?.trim()) {
    query = query.eq('business_id', config.business_id.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch saved designs: ${error.message}`);
  return (data || []).map(mapSavedDesign);
}

/**
 * Save a cake design (element composition, not price) to Supabase. If `id` is
 * provided, updates that existing row instead of inserting a new one — so
 * re-saving a reopened design overwrites it rather than duplicating it.
 * Design names must be unique per business.
 */
export async function saveCakeDesignToSupabase(
  config: SupabaseConfig,
  design: Pick<
    SavedCakeDesign,
    'name' | 'flavor_name' | 'weight_grams' | 'elements' | 'image_phash' | 'image_base64' | 'image_mime_type'
  >,
  id?: string | null,
): Promise<SavedCakeDesign> {
  const supabase = requireClient(config);
  const businessId = config.business_id?.trim();
  if (!businessId) {
    throw new Error('Supabase business_id not configured');
  }

  const name = design.name.trim();

  let dupeQuery = supabase
    .from('cake_saved_designs')
    .select('id')
    .eq('business_id', businessId)
    .ilike('name', name);
  if (id) {
    dupeQuery = dupeQuery.neq('id', id);
  }
  const { data: dupes, error: dupeError } = await dupeQuery;
  if (dupeError) throw new Error(`Failed to check design name: ${dupeError.message}`);
  if (dupes && dupes.length > 0) {
    throw new Error(`A design named "${name}" already exists. Choose a different name.`);
  }

  const row = {
    business_id: businessId,
    name,
    flavor_name: design.flavor_name || null,
    weight_grams: design.weight_grams || null,
    elements: design.elements,
    image_phash: design.image_phash || null,
    image_base64: design.image_base64 || null,
    image_mime_type: design.image_mime_type || null,
  };

  const { data, error } = id
    ? await supabase
        .from('cake_saved_designs')
        .update(row)
        .eq('id', id)
        .select('*')
        .single()
    : await supabase
        .from('cake_saved_designs')
        .insert(row)
        .select('*')
        .single();

  if (error) throw new Error(`Failed to save design: ${error.message}`);
  return mapSavedDesign(data);
}

/**
 * Hard-delete a saved cake design from Supabase by id.
 */
export async function deleteSavedCakeDesignFromSupabase(
  config: SupabaseConfig,
  id: string,
): Promise<void> {
  const supabase = requireClient(config);
  const { error } = await supabase
    .from('cake_saved_designs')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`Failed to delete saved design: ${error.message}`);
}
