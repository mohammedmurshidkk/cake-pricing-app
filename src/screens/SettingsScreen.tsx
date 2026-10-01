import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  Share,
} from 'react-native';
import {loadConfig, saveConfig} from '../utils/storage';
import {
  fetchFlavorsFromSupabase,
  fetchDesignElementsFromSupabase,
  insertFlavorToSupabase,
  updateFlavorInSupabase,
  deleteFlavorFromSupabase,
  insertElementToSupabase,
  updateElementInSupabase,
  deleteElementFromSupabase,
} from '../services/SupabaseService';
import type {AppConfig, FlavorPricing, FlavorSize, DesignElement} from '../types';

interface Props {
  onBack: () => void;
}

type SettingsTab = 'general' | 'supabase' | 'flavors' | 'elements';

/** Backup snapshot before a big batch of edits — CSV opens directly in Excel/Sheets. */
const csvEscape = (v: string | number | boolean): string =>
  `"${String(v).replace(/"/g, '""')}"`;

const elementsToCsv = (elements: DesignElement[]): string => {
  const header = ['element_key', 'element_label', 'price', 'price_type', 'is_active', 'sort_order'];
  const rows = elements.map(e =>
    [e.element_key, e.element_label, e.price, e.price_type, e.is_active, e.sort_order]
      .map(csvEscape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
};

export const SettingsScreen: React.FC<Props> = ({onBack}) => {
  const [config, setConfig] = useState<AppConfig>({
    gemini_api_key: '',
    supabase: {
      url: '',
      anon_key: '',
      business_id: '',
      auto_save_quotes: true,
    },
    flavors: [],
    design_elements: [],
  });
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [loaded, setLoaded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Flavor modal
  const [flavorModalVisible, setFlavorModalVisible] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<FlavorPricing | null>(null);
  const [flavorName, setFlavorName] = useState('');
  const [flavorSizes, setFlavorSizes] = useState<FlavorSize[]>([
    {name: '500g', price: 0, is_base: false},
    {name: '1kg', price: 0, is_base: true},
  ]);

  // Element modal
  const [elementModalVisible, setElementModalVisible] = useState(false);
  const [editingElement, setEditingElement] = useState<DesignElement | null>(null);
  const [elementLabel, setElementLabel] = useState('');
  const [elementKey, setElementKey] = useState('');
  const [elementPrice, setElementPrice] = useState('0');
  const [elementPriceType, setElementPriceType] = useState<'fixed' | 'per_unit'>('fixed');

  useEffect(() => {
    loadConfig().then(c => {
      setConfig(c);
      setLoaded(true);
    });
  }, []);

  const handleSave = useCallback(async () => {
    await saveConfig(config);
    Alert.alert('Saved', 'Configuration saved successfully.');
  }, [config]);

  const handleSaveAndBack = useCallback(async () => {
    await saveConfig(config);
    onBack();
  }, [config, onBack]);

  // ─── SUPABASE SYNC ───────────────────────────────────────
  // DB is the single source of truth. Sync = full pull and replace.
  const handleSyncFromSupabase = async () => {
    if (!config.supabase.url || !config.supabase.anon_key) {
      Alert.alert('Missing Supabase Config', 'Please enter your Supabase URL and Anon Key first.');
      return;
    }
    setIsSyncing(true);
    try {
      const [flavors, elements] = await Promise.all([
        fetchFlavorsFromSupabase(config.supabase),
        fetchDesignElementsFromSupabase(config.supabase),
      ]);
      const updatedConfig: AppConfig = {...config, flavors, design_elements: elements};
      setConfig(updatedConfig);
      await saveConfig(updatedConfig);
      Alert.alert(
        'Synced ✅',
        `Loaded from database:\n• ${flavors.length} flavors\n• ${elements.length} design elements`,
      );
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || 'Failed to sync with Supabase.');
    } finally {
      setIsSyncing(false);
    }
  };

  // ─── FLAVOR CRUD ─────────────────────────────────────────
  const requireSupabase = (): boolean => {
    if (!config.supabase.url || !config.supabase.anon_key) {
      Alert.alert(
        'Supabase Required',
        'Please configure your Supabase URL and Key in the ⚡ Supabase tab first.',
      );
      return false;
    }
    return true;
  };

  const openAddFlavor = () => {
    setEditingFlavor(null);
    setFlavorName('');
    setFlavorSizes([
      {name: '500g', price: 0, is_base: false},
      {name: '1kg', price: 0, is_base: true},
    ]);
    setFlavorModalVisible(true);
  };

  const openEditFlavor = (f: FlavorPricing) => {
    setEditingFlavor(f);
    setFlavorName(f.flavor_name);
    setFlavorSizes([...f.sizes]);
    setFlavorModalVisible(true);
  };

  const saveFlavor = async () => {
    if (!flavorName.trim()) {
      Alert.alert('Error', 'Flavor name is required.');
      return;
    }
    if (!requireSupabase()) return;
    if (!flavorSizes.some(s => s.is_base) && flavorSizes.length > 0) {
      flavorSizes[0].is_base = true;
    }

    const flavorData = {
      flavor_name: flavorName.trim(),
      sizes: flavorSizes.filter(s => s.name.trim()),
      is_active: true as const,
    };

    setIsSaving(true);
    try {
      let saved: FlavorPricing;
      if (editingFlavor) {
        saved = await updateFlavorInSupabase(config.supabase, {...flavorData, id: editingFlavor.id});
        setConfig(prev => ({
          ...prev,
          flavors: prev.flavors.map(f => (f.id === editingFlavor.id ? saved : f)),
        }));
      } else {
        saved = await insertFlavorToSupabase(config.supabase, flavorData);
        setConfig(prev => ({...prev, flavors: [...prev.flavors, saved]}));
      }
      setFlavorModalVisible(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save flavor.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteFlavor = (id: string) => {
    if (!requireSupabase()) return;
    Alert.alert('Delete Flavor', 'Are you sure? This will delete it from the database.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFlavorFromSupabase(config.supabase, id);
            setConfig(prev => ({
              ...prev,
              flavors: prev.flavors.filter(f => f.id !== id),
            }));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to delete flavor.');
          }
        },
      },
    ]);
  };

  // ─── ELEMENT CRUD ────────────────────────────────────────
  const handleExportElements = async () => {
    if (config.design_elements.length === 0) {
      Alert.alert('Nothing to Export', 'No design elements to export yet.');
      return;
    }
    try {
      await Share.share({
        title: 'Design Elements Export',
        message: elementsToCsv(config.design_elements),
      });
    } catch (err: any) {
      Alert.alert('Export Failed', err.message || 'Could not open share sheet.');
    }
  };

  const openAddElement = () => {
    setEditingElement(null);
    setElementLabel('');
    setElementKey('');
    setElementPrice('0');
    setElementPriceType('fixed');
    setElementModalVisible(true);
  };

  const openEditElement = (el: DesignElement) => {
    setEditingElement(el);
    setElementLabel(el.element_label);
    setElementKey(el.element_key);
    setElementPrice(String(el.price));
    setElementPriceType(el.price_type);
    setElementModalVisible(true);
  };

  const saveElement = async () => {
    if (!elementLabel.trim()) {
      Alert.alert('Error', 'Element label is required.');
      return;
    }
    if (!requireSupabase()) return;

    const key =
      elementKey.trim() ||
      elementLabel.trim().toLowerCase().replace(/\s+/g, '_');

    const elementData = {
      element_key: key,
      element_label: elementLabel.trim(),
      price: Number(elementPrice) || 0,
      price_type: elementPriceType,
      is_active: true as const,
      sort_order: editingElement?.sort_order ?? config.design_elements.length,
    };

    setIsSaving(true);
    try {
      let saved: DesignElement;
      if (editingElement) {
        saved = await updateElementInSupabase(config.supabase, {...elementData, id: editingElement.id});
        setConfig(prev => ({
          ...prev,
          design_elements: prev.design_elements.map(e => (e.id === editingElement.id ? saved : e)),
        }));
      } else {
        saved = await insertElementToSupabase(config.supabase, elementData);
        setConfig(prev => ({...prev, design_elements: [...prev.design_elements, saved]}));
      }
      setElementModalVisible(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save element.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteElement = (id: string) => {
    if (!requireSupabase()) return;
    Alert.alert('Delete Element', 'Are you sure? This will delete it from the database.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteElementFromSupabase(config.supabase, id);
            setConfig(prev => ({
              ...prev,
              design_elements: prev.design_elements.filter(e => e.id !== id),
            }));
          } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to delete element.');
          }
        },
      },
    ]);
  };


  // ─── SIZE HELPERS ────────────────────────────────────────
  const addSize = () => {
    setFlavorSizes(prev => [...prev, {name: '', price: 0, is_base: false}]);
  };

  const updateSizeName = (idx: number, name: string) => {
    setFlavorSizes(prev => prev.map((s, i) => (i === idx ? {...s, name} : s)));
  };

  const updateSizePrice = (idx: number, price: string) => {
    setFlavorSizes(prev =>
      prev.map((s, i) => (i === idx ? {...s, price: Number(price) || 0} : s)),
    );
  };

  const toggleBase = (idx: number) => {
    setFlavorSizes(prev =>
      prev.map((s, i) => ({...s, is_base: i === idx})),
    );
  };

  const removeSize = (idx: number) => {
    setFlavorSizes(prev => prev.filter((_, i) => i !== idx));
  };

  if (!loaded) {
    return (
      <View style={[styles.container, {justifyContent: 'center', alignItems: 'center'}]}>
        <Text style={{color: '#6B7280'}}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#7C3AED" barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleSaveAndBack}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={handleSave}>
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['general', 'supabase', 'flavors', 'elements'] as SettingsTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}>
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}>
              {tab === 'general'
                ? '⚙️ General'
                : tab === 'supabase'
                ? '⚡ Supabase'
                : tab === 'flavors'
                ? '🍰 Flavors'
                : '🎨 Elements'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 40}}>
        {/* ── GENERAL TAB ── */}
        {activeTab === 'general' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Gemini AI Key</Text>
            <Text style={styles.cardDesc}>
              Required for instant client-side cake image analysis (Gemini 2.0 Flash).
            </Text>
            <TextInput
              style={styles.input}
              value={config.gemini_api_key}
              onChangeText={v =>
                setConfig(prev => ({...prev, gemini_api_key: v}))
              }
              placeholder="Enter Gemini API key..."
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              secureTextEntry
            />

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>
                  {config.flavors.length}
                </Text>
                <Text style={styles.statLabel}>Flavors</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>
                  {config.design_elements.length}
                </Text>
                <Text style={styles.statLabel}>Elements</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── SUPABASE TAB ── */}
        {activeTab === 'supabase' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Supabase Database Sync</Text>
            <Text style={styles.cardDesc}>
              Connect directly to your Supabase tables to sync pricing and save quotes.
            </Text>

            <Text style={styles.label}>Supabase Project URL</Text>
            <TextInput
              style={styles.input}
              value={config.supabase.url}
              onChangeText={v =>
                setConfig(prev => ({
                  ...prev,
                  supabase: {...prev.supabase, url: v.trim()},
                }))
              }
              placeholder="https://xyzcompany.supabase.co"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Supabase Key (Service Key or Anon Key)</Text>
            <TextInput
              style={styles.input}
              value={config.supabase.anon_key}
              onChangeText={v =>
                setConfig(prev => ({
                  ...prev,
                  supabase: {...prev.supabase, anon_key: v.trim()},
                }))
              }
              placeholder="sb_secret_... or eyJhbGci..."
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              secureTextEntry
            />

            <Text style={styles.label}>Business ID (UUID)</Text>
            <TextInput
              style={styles.input}
              value={config.supabase.business_id}
              onChangeText={v =>
                setConfig(prev => ({
                  ...prev,
                  supabase: {...prev.supabase, business_id: v.trim()},
                }))
              }
              placeholder="Optional if single business"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />


            <TouchableOpacity
              style={[styles.syncButton, isSyncing && {opacity: 0.6}]}
              disabled={isSyncing}
              onPress={handleSyncFromSupabase}>
              {isSyncing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.syncButtonText}>🔄 Pull Latest from Database</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.syncHint}>
              Replaces local data with exactly what's in the database. All devices see the same data.
            </Text>

          </View>
        )}

        {/* ── FLAVORS TAB ── */}
        {activeTab === 'flavors' && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Flavor Pricing ({config.flavors.length})
              </Text>
              <TouchableOpacity
                style={[styles.miniButton, styles.addButton, isSaving && {opacity: 0.5}]}
                disabled={isSaving}
                onPress={openAddFlavor}>
                <Text style={[styles.miniButtonText, {color: '#fff'}]}>
                  {isSaving ? '...' : '+ Add'}
                </Text>
              </TouchableOpacity>
            </View>

            {config.flavors.map(f => (
              <View key={f.id} style={styles.listItem}>
                <TouchableOpacity
                  style={{flex: 1}}
                  onPress={() => openEditFlavor(f)}>
                  <Text style={styles.listItemTitle}>{f.flavor_name}</Text>
                  <Text style={styles.listItemSub}>
                    {f.sizes.map(s => `${s.name}: ₹${s.price}${s.is_base ? ' [BASE]' : ''}`).join('  •  ')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteFlavor(f.id)}>
                  <Text style={styles.deleteBtn}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── ELEMENTS TAB ── */}
        {activeTab === 'elements' && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Design Elements ({config.design_elements.length})
              </Text>
              <View style={{flexDirection: 'row', gap: 8}}>
                <TouchableOpacity
                  style={styles.miniButton}
                  onPress={handleExportElements}>
                  <Text style={styles.miniButtonText}>📤 Export</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.miniButton, styles.addButton, isSaving && {opacity: 0.5}]}
                  disabled={isSaving}
                  onPress={openAddElement}>
                  <Text style={[styles.miniButtonText, {color: '#fff'}]}>
                    {isSaving ? '...' : '+ Add'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.exportHint}>
              Export a backup before adding a big batch — if a sync ever overwrites data, you
              can re-add from this CSV.
            </Text>

            {config.design_elements.map(el => (
              <View key={el.id} style={styles.listItem}>
                <TouchableOpacity
                  style={{flex: 1}}
                  onPress={() => openEditElement(el)}>
                  <Text style={styles.listItemTitle}>{el.element_label}</Text>
                  <Text style={styles.listItemSub}>
                    ₹{el.price}{' '}
                    {el.price_type === 'per_unit' ? '(per unit)' : '(fixed)'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteElement(el.id)}>
                  <Text style={styles.deleteBtn}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* ── FLAVOR MODAL ── */}
      <Modal
        visible={flavorModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setFlavorModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingFlavor ? 'Edit Flavor' : 'Add Flavor'}
            </Text>

            <Text style={styles.label}>Flavor Name</Text>
            <TextInput
              style={styles.input}
              value={flavorName}
              onChangeText={setFlavorName}
              placeholder="e.g. Chocolate"
              placeholderTextColor="#9CA3AF"
            />

            <View style={styles.sizesHeader}>
              <Text style={styles.label}>Sizes</Text>
              <TouchableOpacity onPress={addSize}>
                <Text style={styles.addSizeText}>+ Add Size</Text>
              </TouchableOpacity>
            </View>

            {flavorSizes.map((size, idx) => (
              <View key={idx} style={styles.sizeRow}>
                <TextInput
                  style={[styles.input, {flex: 1, marginBottom: 0}]}
                  value={size.name}
                  onChangeText={v => updateSizeName(idx, v)}
                  placeholder="e.g. 1kg"
                  placeholderTextColor="#9CA3AF"
                />
                <TextInput
                  style={[styles.input, {width: 80, marginBottom: 0}]}
                  value={String(size.price)}
                  onChangeText={v => updateSizePrice(idx, v)}
                  keyboardType="numeric"
                  placeholder="₹"
                  placeholderTextColor="#9CA3AF"
                />
                <TouchableOpacity
                  style={[
                    styles.baseBadge,
                    size.is_base && styles.baseBadgeActive,
                  ]}
                  onPress={() => toggleBase(idx)}>
                  <Text
                    style={[
                      styles.baseBadgeText,
                      size.is_base && styles.baseBadgeTextActive,
                    ]}>
                    BASE
                  </Text>
                </TouchableOpacity>
                {flavorSizes.length > 1 && (
                  <TouchableOpacity onPress={() => removeSize(idx)}>
                    <Text style={{fontSize: 18, color: '#EF4444'}}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                disabled={isSaving}
                onPress={() => setFlavorModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, isSaving && {opacity: 0.6}]}
                disabled={isSaving}
                onPress={saveFlavor}>
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── ELEMENT MODAL ── */}
      <Modal
        visible={elementModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setElementModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingElement ? 'Edit Element' : 'Add Design Element'}
            </Text>

            <Text style={styles.label}>Label</Text>
            <TextInput
              style={styles.input}
              value={elementLabel}
              onChangeText={setElementLabel}
              placeholder="e.g. Fresh Flowers"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.label}>Key</Text>
            <TextInput
              style={styles.input}
              value={elementKey}
              onChangeText={setElementKey}
              placeholder="e.g. fresh_flowers"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Price (₹)</Text>
            <TextInput
              style={styles.input}
              value={elementPrice}
              onChangeText={setElementPrice}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.label}>Price Type</Text>
            <View style={styles.priceTypeRow}>
              <TouchableOpacity
                style={[
                  styles.priceTypeBtn,
                  elementPriceType === 'fixed' && styles.priceTypeBtnActive,
                ]}
                onPress={() => setElementPriceType('fixed')}>
                <Text
                  style={[
                    styles.priceTypeBtnText,
                    elementPriceType === 'fixed' &&
                      styles.priceTypeBtnTextActive,
                  ]}>
                  Fixed
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.priceTypeBtn,
                  elementPriceType === 'per_unit' && styles.priceTypeBtnActive,
                ]}
                onPress={() => setElementPriceType('per_unit')}>
                <Text
                  style={[
                    styles.priceTypeBtnText,
                    elementPriceType === 'per_unit' &&
                      styles.priceTypeBtnTextActive,
                  ]}>
                  Per Unit
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                disabled={isSaving}
                onPress={() => setElementModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, isSaving && {opacity: 0.6}]}
                disabled={isSaving}
                onPress={saveElement}>
                {isSaving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ─── STYLES ─────────────────────────────────────────────────
const PURPLE = '#7C3AED';
const PURPLE_DARK = '#6D28D9';
const PURPLE_LIGHT = '#EDE9FE';

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F9FAFB'},
  header: {
    backgroundColor: PURPLE,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  backArrow: {color: '#fff', fontSize: 26, fontWeight: '700', width: 32},
  saveText: {color: '#DDD6FE', fontSize: 15, fontWeight: '700'},
  content: {flex: 1, padding: 16},

  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  activeTab: {borderBottomWidth: 3, borderBottomColor: PURPLE},
  tabText: {fontSize: 12, fontWeight: '600', color: '#9CA3AF'},
  activeTabText: {color: PURPLE},

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardTitle: {fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6},
  cardDesc: {fontSize: 13, color: '#6B7280', marginBottom: 14, lineHeight: 20},

  // Inputs
  label: {fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6},
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
    marginBottom: 14,
  },

  syncButton: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  syncButtonText: {color: '#fff', fontSize: 15, fontWeight: '700'},
  pushingText: {fontSize: 12, color: '#059669', fontWeight: '600', marginBottom: 8, textAlign: 'center'},
  syncHint: {fontSize: 11, color: '#9CA3AF', marginTop: 8, textAlign: 'center', lineHeight: 16},

  // Stats
  statsRow: {flexDirection: 'row', gap: 12, marginTop: 8},
  statBox: {
    flex: 1,
    backgroundColor: PURPLE_LIGHT,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statNumber: {fontSize: 28, fontWeight: '800', color: PURPLE},
  statLabel: {fontSize: 12, color: PURPLE_DARK, marginTop: 4, fontWeight: '600'},

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {fontSize: 16, fontWeight: '700', color: '#111827'},

  // Mini buttons
  miniButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: PURPLE_LIGHT,
  },
  miniButtonText: {fontSize: 12, fontWeight: '700', color: PURPLE_DARK},
  addButton: {backgroundColor: PURPLE},
  exportHint: {fontSize: 11, color: '#9CA3AF', marginBottom: 12, lineHeight: 16},

  // List items
  listItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  listItemTitle: {fontSize: 15, fontWeight: '700', color: '#111827'},
  listItemSub: {fontSize: 12, color: '#6B7280', marginTop: 4},
  deleteBtn: {fontSize: 20, marginLeft: 12},

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  modalCancelText: {fontWeight: '700', color: '#6B7280'},
  modalSave: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: PURPLE,
    alignItems: 'center',
  },
  modalSaveText: {fontWeight: '700', color: '#fff'},

  // Size row
  sizesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  addSizeText: {fontSize: 13, fontWeight: '700', color: PURPLE},
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  baseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  baseBadgeActive: {backgroundColor: PURPLE, borderColor: PURPLE},
  baseBadgeText: {fontSize: 10, fontWeight: '800', color: '#9CA3AF'},
  baseBadgeTextActive: {color: '#fff'},

  // Price type
  priceTypeRow: {flexDirection: 'row', gap: 12, marginBottom: 8},
  priceTypeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  priceTypeBtnActive: {backgroundColor: PURPLE, borderColor: PURPLE},
  priceTypeBtnText: {fontWeight: '700', color: '#6B7280'},
  priceTypeBtnTextActive: {color: '#fff'},
});
