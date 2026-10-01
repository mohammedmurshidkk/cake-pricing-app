/**
 * ResultScreen — fully editable result after AI analysis.
 *
 * Fixes:
 * - All numeric inputs store RAW STRINGS so backspace works correctly (empty = 0 in calc only).
 * - Quantities: whole numbers only (no decimal). Prices: accept decimals like 1.5, 2.5.
 * - Add Element manually from the configured design elements list.
 */

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image,
  Alert,
  Modal,
} from 'react-native';
import ImageView from 'react-native-image-viewing';
import {loadConfig} from '../utils/storage';
import {calculateBasePrice} from '../utils/pricing';
import {saveQuoteToSupabase, saveCakeDesignToSupabase} from '../services/SupabaseService';
import {computeDHash} from '../utils/imageHash';
import type {
  CakeAnalysisResult,
  DetectedElement,
  DesignElement,
  FlavorPricing,
  AppConfig,
  SavedDesignElement,
} from '../types';

interface Props {
  result: CakeAnalysisResult;
  imageUri: string | null;
  /** Raw base64 of the source photo — from a fresh AI analysis, or carried over from a reopened saved design. Used to compute a perceptual hash and to persist with Save Design. Read-only here either way; there is no edit/remove control for it. */
  imageBase64?: string | null;
  imageMimeType?: string;
  /** Set when this result came from reopening a saved design, so Save Design updates that row instead of creating a duplicate. */
  savedDesignId?: string | null;
  savedDesignName?: string | null;
  onBack: () => void;
  onNewCalculation: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const safeFloat = (s: string): number => {
  const v = parseFloat(s);
  return isNaN(v) || v < 0 ? 0 : v;
};

const safeInt = (s: string): number => {
  const v = parseInt(s, 10);
  return isNaN(v) || v < 0 ? 0 : v;
};

/** Allow only valid partial decimal input: "", digits, one dot, digits after dot. */
const isValidDecimalInput = (s: string) => /^\d*\.?\d*$/.test(s);

/** Allow only integer input */
const isValidIntInput = (s: string) => /^\d*$/.test(s);

// ─── types ────────────────────────────────────────────────────────────────────

/**
 * Same as DetectedElement but ALL numeric fields stored as strings so
 * TextInput can show empty strings without snapping back.
 */
interface EditableElement {
  element_key: string;
  element_label: string;
  confidence: number;
  qtyStr: string;       // raw string for quantity (integer)
  unitPriceStr: string; // raw string for unit price (decimal ok)
  totalPrice: number;   // computed for display
}

const toEditable = (el: DetectedElement): EditableElement => ({
  element_key: el.element_key,
  element_label: el.element_label,
  confidence: el.confidence,
  qtyStr: String(el.quantity),
  unitPriceStr: String(el.unit_price),
  totalPrice: el.total_price,
});

const fromEditable = (el: EditableElement): DetectedElement => {
  const qty = Math.max(1, safeInt(el.qtyStr));
  const unitPrice = safeFloat(el.unitPriceStr);
  return {
    element_key: el.element_key,
    element_label: el.element_label,
    confidence: el.confidence,
    quantity: qty,
    unit_price: unitPrice,
    total_price: unitPrice * qty,
  };
};

const recomputeTotal = (el: EditableElement): EditableElement => {
  const qty = Math.max(1, safeInt(el.qtyStr));
  const unitPrice = safeFloat(el.unitPriceStr);
  return {...el, totalPrice: unitPrice * qty};
};

// ─── colours ──────────────────────────────────────────────────────────────────

const PURPLE = '#7C3AED';
const PURPLE_DARK = '#6D28D9';
const PURPLE_LIGHT = '#EDE9FE';
const GREEN = '#059669';

// ─── component ───────────────────────────────────────────────────────────────

export const ResultScreen: React.FC<Props> = ({
  result,
  imageUri,
  imageBase64,
  imageMimeType,
  savedDesignId,
  savedDesignName,
  onBack,
  onNewCalculation,
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);

  // ── flavor & weight (raw strings) ───────────────────────────────────────────
  const [selectedFlavor, setSelectedFlavor] = useState<FlavorPricing | null>(null);
  const [weightStr, setWeightStr] = useState<string>(
    String(result.detected_weight_grams || 1000),
  );
  const [basePriceStr, setBasePriceStr] = useState<string>(
    String(result.price_breakdown.base_price),
  );

  // ── elements (editable) ─────────────────────────────────────────────────────
  const [elements, setElements] = useState<EditableElement[]>(
    (result.detected_elements || []).map(toEditable),
  );

  // ── modals ──────────────────────────────────────────────────────────────────
  const [flavorPickerVisible, setFlavorPickerVisible] = useState(false);
  const [addElementVisible, setAddElementVisible] = useState(false);
  const [saveDesignVisible, setSaveDesignVisible] = useState(false);
  const [designNameInput, setDesignNameInput] = useState('');
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);

  // ── saving ──────────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  // id of the row in cake_price_quotes once first saved, so later saves UPDATE
  // it instead of inserting a duplicate row with stale AI numbers.
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);
  // id of the row in cake_saved_designs — prefilled if reopened from Saved
  // Designs, set after the first Save Design so re-saving updates, not duplicates.
  const [currentSavedDesignId, setCurrentSavedDesignId] = useState<string | null>(
    savedDesignId ?? null,
  );

  // ── computed totals ─────────────────────────────────────────────────────────
  const basePrice = safeFloat(basePriceStr);
  const elementsTotal = elements.reduce((s, e) => s + e.totalPrice, 0);
  const grandTotal = basePrice + elementsTotal;

  // ── load config ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadConfig().then(c => {
      setConfig(c);
      if (c.flavors.length > 0) {
        const name = (result.detected_flavor || '').toLowerCase().trim();
        const matched =
          c.flavors.find(f => f.flavor_name.toLowerCase() === name) ||
          c.flavors.find(
            f =>
              f.flavor_name.toLowerCase().includes(name) ||
              name.includes(f.flavor_name.toLowerCase()),
          );
        if (matched) {
          setSelectedFlavor(matched);
        }
      }
    });
  }, [result.detected_flavor]);

  // ── auto-recalc base price when flavor or weight changes ────────────────────
  useEffect(() => {
    if (selectedFlavor) {
      const grams = safeInt(weightStr);
      if (grams > 0) {
        const computed = calculateBasePrice(selectedFlavor, grams);
        setBasePriceStr(String(computed));
      }
    }
    // deliberately NOT listing basePriceStr as dep — user can override it manually
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlavor, weightStr]);

  // ── element editors ─────────────────────────────────────────────────────────

  const updateQty = (idx: number, raw: string) => {
    if (!isValidIntInput(raw)) {
      return; // reject non-integer (no dots for qty)
    }
    setElements(prev =>
      prev.map((el, i) =>
        i === idx ? recomputeTotal({...el, qtyStr: raw}) : el,
      ),
    );
  };

  const updateUnitPrice = (idx: number, raw: string) => {
    if (!isValidDecimalInput(raw)) {
      return; // reject invalid chars
    }
    setElements(prev =>
      prev.map((el, i) =>
        i === idx ? recomputeTotal({...el, unitPriceStr: raw}) : el,
      ),
    );
  };

  const removeElement = (idx: number) => {
    setElements(prev => prev.filter((_, i) => i !== idx));
  };

  // ── add element manually ────────────────────────────────────────────────────

  const addDesignElement = (de: DesignElement) => {
    const newEl: EditableElement = {
      element_key: de.element_key,
      element_label: de.element_label,
      confidence: 1.0,
      qtyStr: '1',
      unitPriceStr: String(de.price),
      totalPrice: de.price,
    };
    setElements(prev => [...prev, newEl]);
    setAddElementVisible(false);
  };

  // ── save quote ──────────────────────────────────────────────────────────────

  const handleSaveQuote = async () => {
    if (!config?.supabase?.url || !config?.supabase?.business_id) {
      Alert.alert(
        'Supabase not configured',
        'Please add Supabase URL and Business ID in Settings → ⚡ Supabase.',
      );
      return;
    }
    setIsSaving(true);
    const updatedResult: CakeAnalysisResult = {
      ...result,
      detected_flavor: selectedFlavor?.flavor_name || result.detected_flavor,
      detected_weight_grams: safeInt(weightStr) || result.detected_weight_grams,
      detected_elements: elements.map(fromEditable),
      price_breakdown: {
        base_price: basePrice,
        design_elements_total: elementsTotal,
        grand_total: grandTotal,
      },
    };
    const res = await saveQuoteToSupabase(config.supabase, updatedResult, null, savedQuoteId);
    setIsSaving(false);
    if (res.success) {
      if (res.id) setSavedQuoteId(res.id);
      Alert.alert('Quote Saved ✅', `Saved to Supabase (ID: ${res.id})`);
    } else {
      Alert.alert('Save Failed', res.error || 'Unknown error');
    }
  };

  // ── save reusable design ────────────────────────────────────────────────────
  // Freezes element_key + quantity only (no price) so a future re-check pulls
  // fresh prices from Settings → Elements instead of drifting like a fresh AI
  // re-analysis of the same photo would.

  const openSaveDesign = () => {
    if (!config?.supabase?.url || !config?.supabase?.business_id) {
      Alert.alert(
        'Supabase not configured',
        'Please add Supabase URL and Business ID in Settings → ⚡ Supabase.',
      );
      return;
    }
    if (elements.length === 0) {
      Alert.alert('No Elements', 'Add at least one design element before saving.');
      return;
    }
    setDesignNameInput(
      savedDesignName || selectedFlavor?.flavor_name || result.detected_flavor || '',
    );
    setSaveDesignVisible(true);
  };

  const confirmSaveDesign = async () => {
    const name = designNameInput.trim();
    if (!name) {
      Alert.alert('Name Required', 'Give this design a name so you can find it again.');
      return;
    }
    setIsSavingDesign(true);
    const savedElements: SavedDesignElement[] = elements.map(el => ({
      element_key: el.element_key,
      element_label: el.element_label,
      quantity: Math.max(1, safeInt(el.qtyStr)),
      unit_price: safeFloat(el.unitPriceStr),
    }));
    const phash = imageBase64
      ? computeDHash(imageBase64, imageMimeType || 'image/jpeg')
      : null;
    try {
      const saved = await saveCakeDesignToSupabase(
        config!.supabase,
        {
          name,
          flavor_name: selectedFlavor?.flavor_name || result.detected_flavor || null,
          weight_grams: safeInt(weightStr) || result.detected_weight_grams || null,
          elements: savedElements,
          image_phash: phash,
          image_base64: imageBase64 || null,
          image_mime_type: imageMimeType || null,
        },
        currentSavedDesignId,
      );
      setCurrentSavedDesignId(saved.id || null);
      setIsSavingDesign(false);
      setSaveDesignVisible(false);
      Alert.alert('Design Saved ✅', `"${name}" saved. Reopen it anytime from Saved Designs to re-check the price.`);
    } catch (err: any) {
      setIsSavingDesign(false);
      Alert.alert('Save Failed', err.message || 'Unknown error');
    }
  };

  // ── data ────────────────────────────────────────────────────────────────────

  const flavors = config?.flavors || [];
  const configElements: DesignElement[] = config?.design_elements || [];
  // only show elements NOT already added
  const addableElements = configElements.filter(
    ce => !elements.some(e => e.element_key === ce.element_key),
  );

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={PURPLE} barStyle="light-content" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit & Confirm Price</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 40}}>
        {/* Image */}
        {imageUri && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setImagePreviewVisible(true)}>
            <Image source={{uri: imageUri}} style={styles.resultImage} />
          </TouchableOpacity>
        )}

        {/* ── Live grand total ── */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Final Quote</Text>
          <Text style={styles.totalPrice}>₹{grandTotal.toLocaleString()}</Text>
          <Text style={styles.totalSub}>
            Base ₹{basePrice.toLocaleString()} + Elements ₹{elementsTotal.toLocaleString()}
          </Text>
        </View>

        {/* ── Flavor & Weight ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🍰 Flavor & Weight</Text>

          <Text style={styles.fieldLabel}>Flavor</Text>
          <TouchableOpacity
            style={styles.selectBox}
            onPress={() => setFlavorPickerVisible(true)}>
            <Text style={styles.selectBoxText}>
              {selectedFlavor
                ? selectedFlavor.flavor_name
                : result.detected_flavor || 'Tap to select flavor'}
            </Text>
            <Text style={styles.selectCaret}>▾</Text>
          </TouchableOpacity>

          <Text style={styles.fieldLabel}>Weight (grams)</Text>
          <TextInput
            style={styles.editInput}
            value={weightStr}
            onChangeText={raw => {
              if (isValidIntInput(raw)) {
                setWeightStr(raw);
              }
            }}
            keyboardType="numeric"
            placeholder="e.g. 1000"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={styles.fieldLabel}>Base Price (₹)</Text>
          <TextInput
            style={[styles.editInput, {color: PURPLE, fontWeight: '700'}]}
            value={basePriceStr}
            onChangeText={raw => {
              if (isValidDecimalInput(raw)) {
                setBasePriceStr(raw);
              }
            }}
            keyboardType="decimal-pad"
            placeholder="Base price"
            placeholderTextColor="#9CA3AF"
          />
          {selectedFlavor && (
            <Text style={styles.sizesHint}>
              Sizes:{' '}
              {selectedFlavor.sizes
                .map(s => `${s.name}=₹${s.price}${s.is_base ? '[BASE]' : ''}`)
                .join('  •  ')}
            </Text>
          )}
        </View>

        {/* ── Design Elements ── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>🎨 Design Elements</Text>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => setAddElementVisible(true)}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          {elements.length === 0 && (
            <Text style={styles.emptyText}>
              No elements detected. Tap <Text style={{fontWeight: '700'}}>+ Add</Text> to add manually.
            </Text>
          )}

          {elements.map((el, idx) => (
            <View key={`${el.element_key}-${idx}`} style={styles.elementCard}>
              {/* Element name + remove */}
              <View style={styles.elementHeader}>
                <Text style={styles.elementName}>{el.element_label}</Text>
                <TouchableOpacity onPress={() => removeElement(idx)}>
                  <Text style={styles.removeBtnText}>✕ Remove</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.elementFieldsRow}>
                {/* Quantity */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.miniLabel}>Qty</Text>
                  <View style={styles.qtyRow}>
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => {
                        const v = Math.max(0, safeInt(el.qtyStr) - 1);
                        updateQty(idx, String(v));
                      }}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.qtyInput}
                      value={el.qtyStr}
                      onChangeText={raw => updateQty(idx, raw)}
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      style={styles.qtyBtn}
                      onPress={() => {
                        const v = safeInt(el.qtyStr) + 1;
                        updateQty(idx, String(v));
                      }}>
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Unit Price */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.miniLabel}>Unit Price (₹)</Text>
                  <View style={styles.unitPriceRow}>
                    <Text style={styles.rupeeSign}>₹</Text>
                    <TextInput
                      style={styles.unitPriceInput}
                      value={el.unitPriceStr}
                      onChangeText={raw => updateUnitPrice(idx, raw)}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      placeholder="0"
                      placeholderTextColor="#9CA3AF"
                    />
                  </View>
                </View>

                {/* Total */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.miniLabel}>Total</Text>
                  <Text style={styles.elementTotal}>
                    ₹{el.totalPrice.toLocaleString()}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {/* Elements subtotal */}
          {elements.length > 0 && (
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Elements Total</Text>
              <Text style={styles.subtotalValue}>
                ₹{elementsTotal.toLocaleString()}
              </Text>
            </View>
          )}
        </View>

        {/* ── Grand total summary ── */}
        <View style={styles.grandCard}>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Base Price</Text>
            <Text style={styles.grandValue}>₹{basePrice.toLocaleString()}</Text>
          </View>
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Design Elements</Text>
            <Text style={styles.grandValue}>₹{elementsTotal.toLocaleString()}</Text>
          </View>
          <View style={[styles.grandRow, styles.grandFinalRow]}>
            <Text style={styles.grandFinalLabel}>Grand Total</Text>
            <Text style={styles.grandFinalValue}>₹{grandTotal.toLocaleString()}</Text>
          </View>
        </View>

        {/* Analysis */}
        {!!result.complexity_reasoning && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI Analysis</Text>
            <Text style={styles.reasoningText}>{result.complexity_reasoning}</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, {backgroundColor: GREEN}]}
            onPress={handleSaveQuote}
            disabled={isSaving}>
            <Text style={styles.actionBtnText}>
              {isSaving ? 'Saving...' : '💾 Save Quote'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, {backgroundColor: '#0891B2'}]}
            onPress={openSaveDesign}>
            <Text style={styles.actionBtnText}>📋 Save Design</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, {backgroundColor: PURPLE}]}
            onPress={onNewCalculation}>
            <Text style={styles.actionBtnText}>📸 New Cake</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ═══════════════════════════════════════
          FLAVOR PICKER MODAL
      ═══════════════════════════════════════ */}
      <Modal
        visible={flavorPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFlavorPickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Flavor</Text>
              <TouchableOpacity onPress={() => setFlavorPickerVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {flavors.length === 0 && (
                <Text style={styles.emptyText}>
                  No flavors saved. Go to Settings → Flavors to add.
                </Text>
              )}
              {flavors.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.pickerOption,
                    selectedFlavor?.id === f.id && styles.pickerOptionActive,
                  ]}
                  onPress={() => {
                    setSelectedFlavor(f);
                    setFlavorPickerVisible(false);
                  }}>
                  <Text
                    style={[
                      styles.pickerOptionText,
                      selectedFlavor?.id === f.id && styles.pickerOptionTextActive,
                    ]}>
                    {f.flavor_name}
                  </Text>
                  <Text style={styles.pickerOptionSub}>
                    {f.sizes.map(s => `${s.name}: ₹${s.price}`).join('  •  ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════
          ADD ELEMENT MODAL
      ═══════════════════════════════════════ */}
      <Modal
        visible={addElementVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setAddElementVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Design Element</Text>
              <TouchableOpacity onPress={() => setAddElementVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {addableElements.length === 0 && (
                <Text style={styles.emptyText}>
                  {configElements.length === 0
                    ? 'No design elements configured. Go to Settings → Elements to add.'
                    : 'All configured elements are already added.'}
                </Text>
              )}
              {addableElements.map(de => (
                <TouchableOpacity
                  key={de.element_key}
                  style={styles.pickerOption}
                  onPress={() => addDesignElement(de)}>
                  <Text style={styles.pickerOptionText}>{de.element_label}</Text>
                  <Text style={styles.pickerOptionSub}>
                    ₹{de.price}
                    {de.price_type === 'per_unit' ? ' per unit' : ' flat'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ═══════════════════════════════════════
          SAVE DESIGN MODAL
      ═══════════════════════════════════════ */}
      <Modal
        visible={saveDesignVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSaveDesignVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Save Reusable Design</Text>
              <TouchableOpacity onPress={() => setSaveDesignVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Design Name</Text>
            <TextInput
              style={styles.editInput}
              value={designNameInput}
              onChangeText={setDesignNameInput}
              placeholder="e.g. 3-tier fondant wedding cake"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />
            <Text style={styles.sizesHint}>
              Saves the {elements.length} element{elements.length === 1 ? '' : 's'} and quantities
              above, plus flavor and weight. Price is always recalculated from current
              Settings → Elements prices when you reopen it — not stored here.
            </Text>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                {backgroundColor: '#0891B2', marginTop: 16, flex: 0, width: '100%'},
              ]}
              onPress={confirmSaveDesign}
              disabled={isSavingDesign}>
              <Text style={styles.actionBtnText}>
                {isSavingDesign ? 'Saving...' : 'Save Design'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Full-screen zoomable image preview ── */}
      <ImageView
        images={imageUri ? [{uri: imageUri}] : []}
        imageIndex={0}
        visible={imagePreviewVisible}
        onRequestClose={() => setImagePreviewVisible(false)}
      />
    </View>
  );
};

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F9FAFB'},

  header: {
    backgroundColor: PURPLE,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {color: '#fff', fontSize: 17, fontWeight: '700'},
  backArrow: {color: '#fff', fontSize: 26, fontWeight: '700'},
  headerSpacer: {width: 26},

  content: {flex: 1, padding: 14},

  resultImage: {
    width: '100%',
    height: 200,
    borderRadius: 14,
    resizeMode: 'cover',
    marginBottom: 14,
  },

  totalCard: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  totalLabel: {color: '#DDD6FE', fontSize: 13, fontWeight: '600'},
  totalPrice: {color: '#fff', fontSize: 38, fontWeight: '800', marginTop: 4},
  totalSub: {color: '#C4B5FD', fontSize: 13, marginTop: 6},

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.07,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 0},

  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  selectBox: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#FAFAFA',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectBoxText: {fontSize: 15, color: '#111827', fontWeight: '600'},
  selectCaret: {fontSize: 16, color: '#6B7280'},
  sizesHint: {fontSize: 11, color: '#9CA3AF', marginTop: 6},

  addBtn: {
    backgroundColor: PURPLE_LIGHT,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: {color: PURPLE_DARK, fontWeight: '700', fontSize: 13},

  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 16,
    lineHeight: 20,
  },

  // Element card
  elementCard: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#FAFAFA',
  },
  elementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  elementName: {fontSize: 14, fontWeight: '700', color: '#111827', flex: 1},
  removeBtnText: {fontSize: 12, color: '#EF4444', fontWeight: '600'},

  elementFieldsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  fieldGroup: {flex: 1},
  miniLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 5,
  },

  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  qtyBtn: {
    backgroundColor: PURPLE_LIGHT,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  qtyBtnText: {fontSize: 16, fontWeight: '700', color: PURPLE_DARK},
  qtyInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    paddingVertical: 7,
  },

  unitPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  rupeeSign: {fontSize: 13, color: '#6B7280'},
  unitPriceInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    paddingVertical: 8,
    paddingLeft: 4,
  },

  elementTotal: {
    fontSize: 15,
    fontWeight: '700',
    color: GREEN,
    textAlign: 'right',
    paddingVertical: 9,
  },

  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 12,
    marginTop: 4,
  },
  subtotalLabel: {fontSize: 14, color: '#6B7280', fontWeight: '600'},
  subtotalValue: {fontSize: 14, fontWeight: '700', color: '#111827'},

  grandCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.07,
    shadowRadius: 3,
  },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  grandLabel: {fontSize: 14, color: '#6B7280'},
  grandValue: {fontSize: 14, color: '#374151', fontWeight: '600'},
  grandFinalRow: {
    borderTopWidth: 2,
    borderTopColor: PURPLE_LIGHT,
    marginTop: 6,
    paddingTop: 14,
  },
  grandFinalLabel: {fontSize: 17, fontWeight: '800', color: PURPLE},
  grandFinalValue: {fontSize: 17, fontWeight: '800', color: PURPLE},

  reasoningText: {fontSize: 13, color: '#4B5563', lineHeight: 21},

  actionsRow: {flexDirection: 'row', gap: 12, marginBottom: 8},
  actionBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnText: {color: '#fff', fontSize: 15, fontWeight: '700'},

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 12,
  },
  modalTitle: {fontSize: 18, fontWeight: '800', color: '#111827'},
  modalClose: {fontSize: 20, color: '#9CA3AF', padding: 4},
  pickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  pickerOptionActive: {
    backgroundColor: PURPLE_LIGHT,
    borderColor: PURPLE,
  },
  pickerOptionText: {fontSize: 16, fontWeight: '700', color: '#111827'},
  pickerOptionTextActive: {color: PURPLE},
  pickerOptionSub: {fontSize: 12, color: '#9CA3AF', marginTop: 4},
});
