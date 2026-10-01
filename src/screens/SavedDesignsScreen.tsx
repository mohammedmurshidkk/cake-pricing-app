/**
 * SavedDesignsScreen — browse cake designs saved from a previous result.
 *
 * Selecting a design does NOT re-run AI detection. It rebuilds the price
 * from the saved element_key/quantity list against the CURRENT master
 * prices in Settings → Elements/Flavors (see pricing.buildAnalysisFromSavedDesign),
 * so re-checking the same cake gives a stable, repeatable price instead of
 * whatever a fresh AI analysis happens to detect that run.
 */

import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import {loadConfig} from '../utils/storage';
import {buildAnalysisFromSavedDesign} from '../utils/pricing';
import {
  fetchSavedCakeDesigns,
  deleteSavedCakeDesignFromSupabase,
} from '../services/SupabaseService';
import type {AppConfig, SavedCakeDesign, CakeAnalysisResult} from '../types';

interface Props {
  onBack: () => void;
  onSelectDesign: (result: CakeAnalysisResult, design: SavedCakeDesign) => void;
}

const PURPLE = '#7C3AED';
const TEAL = '#0891B2';

export const SavedDesignsScreen: React.FC<Props> = ({onBack, onSelectDesign}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [designs, setDesigns] = useState<SavedCakeDesign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const c = await loadConfig();
      setConfig(c);
      if (!c.supabase?.url || !c.supabase?.business_id) {
        setError('Supabase not configured. Add it in Settings → ⚡ Supabase.');
        setDesigns([]);
        return;
      }
      const rows = await fetchSavedCakeDesigns(c.supabase);
      setDesigns(rows);
    } catch (e: any) {
      setError(e.message || 'Failed to load saved designs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSelect = (design: SavedCakeDesign) => {
    if (!config) {
      return;
    }
    const result = buildAnalysisFromSavedDesign(design, config);
    onSelectDesign(result, design);
  };

  const handleDelete = (design: SavedCakeDesign) => {
    if (!config?.supabase || !design.id) {
      return;
    }
    Alert.alert('Delete Design', `Delete "${design.name}"? This cannot be undone.`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(design.id!);
          try {
            await deleteSavedCakeDesignFromSupabase(config.supabase, design.id!);
            setDesigns(prev => prev.filter(d => d.id !== design.id));
          } catch (e: any) {
            Alert.alert('Delete Failed', e.message || 'Unknown error');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={PURPLE} barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Saved Designs</Text>
        <View style={{width: 26}} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 40}}>
        {isLoading && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={PURPLE} size="large" />
          </View>
        )}

        {!isLoading && error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && !error && designs.length === 0 && (
          <Text style={styles.emptyText}>
            No saved designs yet. From a calculated result, tap{' '}
            <Text style={{fontWeight: '700'}}>📋 Save Design</Text> to add one here for
            consistent re-checking later.
          </Text>
        )}

        {designs.map(design => (
          <View key={design.id} style={styles.card}>
            <View style={styles.cardTopRow}>
              <TouchableOpacity
                style={styles.cardInfo}
                onPress={() => handleSelect(design)}>
                <Text style={styles.designName}>{design.name}</Text>
                <Text style={styles.designSub}>
                  {design.flavor_name || 'No flavor'} • {design.weight_grams || 1000}g •{' '}
                  {design.elements.length} element{design.elements.length === 1 ? '' : 's'}
                </Text>
                {design.elements.length > 0 && (
                  <Text style={styles.designElements} numberOfLines={2}>
                    {design.elements.map(e => `${e.element_label} ×${e.quantity}`).join(', ')}
                  </Text>
                )}
              </TouchableOpacity>
              {design.image_base64 ? (
                <Image
                  source={{
                    uri: `data:${design.image_mime_type || 'image/jpeg'};base64,${design.image_base64}`,
                  }}
                  style={styles.designThumb}
                />
              ) : (
                <View style={[styles.designThumb, styles.designThumbPlaceholder]}>
                  <Text style={styles.designThumbPlaceholderText}>🎂</Text>
                </View>
              )}
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.smallBtn, {backgroundColor: TEAL}]}
                onPress={() => handleSelect(design)}>
                <Text style={styles.smallBtnText}>Recalculate Price</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(design)}
                disabled={deletingId === design.id}>
                <Text style={styles.deleteBtnText}>
                  {deletingId === design.id ? '...' : '✕ Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

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
  content: {flex: 1, padding: 14},

  centerBox: {paddingVertical: 60, alignItems: 'center'},

  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  errorText: {color: '#B91C1C', fontSize: 14},

  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 40,
    lineHeight: 20,
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.07,
    shadowRadius: 3,
  },
  cardTopRow: {flexDirection: 'row', alignItems: 'flex-start'},
  cardInfo: {flex: 1, paddingRight: 12},
  designThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  designThumbPlaceholder: {alignItems: 'center', justifyContent: 'center'},
  designThumbPlaceholderText: {fontSize: 24},
  designName: {fontSize: 16, fontWeight: '700', color: '#111827'},
  designSub: {fontSize: 12, color: '#6B7280', marginTop: 4},
  designElements: {fontSize: 12, color: '#9CA3AF', marginTop: 6, lineHeight: 17},

  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  smallBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  smallBtnText: {color: '#fff', fontWeight: '700', fontSize: 13},
  deleteBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  deleteBtnText: {color: '#B91C1C', fontWeight: '700', fontSize: 13},
});
