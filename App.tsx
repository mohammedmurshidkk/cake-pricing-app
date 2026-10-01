import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {launchImageLibrary, launchCamera} from 'react-native-image-picker';
import {loadConfig} from './src/utils/storage';
import {analyzeCakeImage} from './src/services/GeminiService';
import {fetchSavedCakeDesigns} from './src/services/SupabaseService';
import {computeDHash, findClosestSavedDesign} from './src/utils/imageHash';
import {buildAnalysisFromSavedDesign} from './src/utils/pricing';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {ResultScreen} from './src/screens/ResultScreen';
import {SavedDesignsScreen} from './src/screens/SavedDesignsScreen';
import type {Screen, CakeAnalysisResult, AppConfig, SavedCakeDesign} from './src/types';


const App = () => {
  const [screen, setScreen] = useState<Screen>('home');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<CakeAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when the current result came from reopening a saved design, so
  // ResultScreen's "Save Design" updates that same row instead of duplicating it.
  const [openedDesignId, setOpenedDesignId] = useState<string | null>(null);
  const [openedDesignName, setOpenedDesignName] = useState<string | null>(null);

  const resetCalculation = useCallback(() => {
    setImageUri(null);
    setImageBase64(null);
    setResult(null);
    setError(null);
    setIsAnalyzing(false);
    setOpenedDesignId(null);
    setOpenedDesignName(null);
  }, []);

  const pickImage = useCallback(async (fromCamera: boolean) => {
    resetCalculation();
    const options = {
      mediaType: 'photo' as const,
      includeBase64: true,
      maxWidth: 1024,
      maxHeight: 1024,
      quality: 0.8 as const,
    };

    const handler = fromCamera ? launchCamera : launchImageLibrary;
    const response = await handler(options);

    if (response.didCancel || response.errorCode) {
      return;
    }

    const asset = response.assets?.[0];
    if (asset?.base64 && asset?.uri) {
      setImageUri(asset.uri);
      setImageBase64(asset.base64);
      setImageMime(asset.type || 'image/jpeg');
    }
  }, [resetCalculation]);

  // Runs the actual Gemini analysis. Split out so both the normal path and
  // the "similar design found, but run AI anyway" choice can call it.
  const runAiAnalysis = useCallback(
    async (base64: string, mime: string, config: AppConfig) => {
      setIsAnalyzing(true);
      try {
        const analysis = await analyzeCakeImage(base64, mime, config);
        setResult(analysis);
        setScreen('result');
      } catch (e: any) {
        setError(e.message || 'Analysis failed');
        Alert.alert('Error', e.message || 'Failed to analyze image.');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [],
  );

  // A perceptual-hash match was found against a previously saved design.
  // Never auto-apply it — ask, since even a genuinely identical cake photo
  // can legitimately need a different price (different weight requested,
  // a topper swapped, etc).
  const confirmUseSavedDesign = useCallback(
    (base64: string, mime: string, config: AppConfig, match: SavedCakeDesign) => {
      Alert.alert(
        'Similar Design Found',
        `This photo looks like a saved design: "${match.name}". Use its saved elements (priced at today's rates) instead of running a fresh AI analysis?`,
        [
          {
            text: 'Run New AI Analysis',
            style: 'cancel',
            onPress: () => runAiAnalysis(base64, mime, config),
          },
          {
            text: 'Use Saved Design',
            onPress: () => {
              setResult(buildAnalysisFromSavedDesign(match, config));
              setScreen('result');
            },
          },
        ],
      );
    },
    [runAiAnalysis],
  );

  const handleAnalyze = useCallback(async () => {
    if (!imageBase64) {
      Alert.alert('No Image', 'Please select or capture a cake image first.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const config: AppConfig = await loadConfig();
      if (!config.gemini_api_key) {
        Alert.alert(
          'API Key Missing',
          'Please add your Gemini API key in Settings.',
        );
        setIsAnalyzing(false);
        return;
      }

      // Before spending an AI call: does this photo look like a design we
      // already saved? If so, ask rather than silently reusing OR silently
      // re-analyzing — a hash match is a hint, not proof.
      if (config.supabase?.url && config.supabase?.business_id) {
        try {
          const hash = computeDHash(imageBase64, imageMime);
          if (hash) {
            const saved = await fetchSavedCakeDesigns(config.supabase);
            const match = findClosestSavedDesign(hash, saved);
            if (match) {
              setIsAnalyzing(false);
              confirmUseSavedDesign(imageBase64, imageMime, config, match.design);
              return;
            }
          }
        } catch (e) {
          console.warn('Saved-design similarity check failed:', e);
          // fall through to a normal AI analysis
        }
      }

      await runAiAnalysis(imageBase64, imageMime, config);
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
      Alert.alert('Error', e.message || 'Failed to analyze image.');
      setIsAnalyzing(false);
    }
  }, [imageBase64, imageMime, runAiAnalysis, confirmUseSavedDesign]);

  // ─── HOME SCREEN ─────────────────────────────────────────
  if (screen === 'home') {
    return (
      <View style={styles.container}>
        <StatusBar backgroundColor="#7C3AED" barStyle="light-content" />
        <View style={styles.header}>
          <Text style={styles.title}>🎂 Cake Pricer</Text>
        </View>

        <View style={styles.homeContent}>
          <View style={styles.logoArea}>
            <Text style={styles.logoEmoji}>🎂</Text>
            <Text style={styles.logoSubtext}>
              Upload a cake design image{'\n'}to get an instant price estimate
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              resetCalculation();
              setScreen('calculate');
            }}>
            <Text style={styles.primaryButtonText}>📸 Calculate Price</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              resetCalculation();
              pickImage(false).then(() => setScreen('calculate'));
            }}>
            <Text style={styles.primaryButtonText}>🖼️ Pick from Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, {backgroundColor: '#0891B2'}]}
            onPress={() => {
              resetCalculation();
              setScreen('saved-designs');
            }}>
            <Text style={styles.primaryButtonText}>📋 Saved Designs</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setScreen('settings')}>
          <Text style={styles.settingsButtonText}>⚙️ Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── SETTINGS SCREEN ─────────────────────────────────────
  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('home')} />;
  }

  // ─── SAVED DESIGNS SCREEN ─────────────────────────────────
  if (screen === 'saved-designs') {
    return (
      <SavedDesignsScreen
        onBack={() => setScreen('home')}
        onSelectDesign={(analysis, design) => {
          setImageBase64(design.image_base64 || null);
          setImageMime(design.image_mime_type || 'image/jpeg');
          setImageUri(
            design.image_base64
              ? `data:${design.image_mime_type || 'image/jpeg'};base64,${design.image_base64}`
              : null,
          );
          setOpenedDesignId(design.id || null);
          setOpenedDesignName(design.name);
          setResult(analysis);
          setScreen('result');
        }}
      />
    );
  }

  // ─── RESULT SCREEN ───────────────────────────────────────
  if (screen === 'result' && result) {
    return (
      <ResultScreen
        result={result}
        imageUri={imageUri}
        imageBase64={imageBase64}
        imageMimeType={imageMime}
        savedDesignId={openedDesignId}
        savedDesignName={openedDesignName}
        onBack={() => {
          resetCalculation();
          setScreen('home');
        }}
        onNewCalculation={() => {
          resetCalculation();
          setScreen('calculate');
        }}
      />
    );
  }


  // ─── CALCULATE SCREEN ────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="#7C3AED" barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            resetCalculation();
            setScreen('home');
          }}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calculate Price</Text>
        <View style={{width: 32}} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.calcContent}>
        {/* Image Preview / Picker */}
        {imageUri ? (
          <View>
            <Image source={{uri: imageUri}} style={styles.previewImage} />
            <TouchableOpacity
              style={styles.changeImageButton}
              onPress={() => resetCalculation()}>
              <Text style={styles.changeImageText}>✕ Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.placeholderArea}>
            <Text style={styles.placeholderEmoji}>📷</Text>
            <Text style={styles.placeholderText}>
              Upload or capture a cake image
            </Text>

            <View style={styles.pickRow}>
              <TouchableOpacity
                style={styles.pickButton}
                onPress={() => pickImage(true)}>
                <Text style={styles.pickButtonText}>📸 Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.pickButton}
                onPress={() => pickImage(false)}>
                <Text style={styles.pickButtonText}>🖼️ Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Analyze Button */}
        <TouchableOpacity
          style={[
            styles.analyzeButton,
            (!imageBase64 || isAnalyzing) && styles.disabledButton,
          ]}
          disabled={!imageBase64 || isAnalyzing}
          onPress={handleAnalyze}>
          {isAnalyzing ? (
            <View style={styles.analyzingRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.analyzeButtonText}>
                {'  '}Analyzing with AI...
              </Text>
            </View>
          ) : (
            <Text style={styles.analyzeButtonText}>
              🤖 Analyze & Calculate Price
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

// ─── STYLES ─────────────────────────────────────────────────
const PURPLE = '#7C3AED';
const PURPLE_DARK = '#6D28D9';
const PURPLE_LIGHT = '#EDE9FE';
const BG = '#F9FAFB';

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: BG},
  header: {
    backgroundColor: PURPLE,
    paddingHorizontal: 20,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {color: '#fff', fontSize: 24, fontWeight: 'bold'},
  headerTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  backArrow: {color: '#fff', fontSize: 26, fontWeight: '700', width: 32},
  content: {flex: 1, padding: 16},

  // Home
  homeContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  logoArea: {alignItems: 'center', marginBottom: 32},
  logoEmoji: {fontSize: 80},
  logoSubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 24,
  },
  primaryButton: {
    backgroundColor: PURPLE,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryButtonText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  settingsButton: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingVertical: 18,
    alignItems: 'center',
  },
  settingsButtonText: {fontSize: 16, color: '#6B7280', fontWeight: '600'},

  // Calculate
  calcContent: {paddingBottom: 32},
  placeholderArea: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    paddingVertical: 40,
    alignItems: 'center',
    marginBottom: 20,
  },
  placeholderEmoji: {fontSize: 48},
  placeholderText: {fontSize: 16, color: '#9CA3AF', marginTop: 12},
  pickRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  pickButton: {
    backgroundColor: PURPLE_LIGHT,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  pickButtonText: {color: PURPLE_DARK, fontWeight: '700', fontSize: 15},
  previewImage: {
    width: '100%',
    height: 280,
    borderRadius: 16,
    resizeMode: 'cover',
    marginBottom: 12,
  },
  changeImageButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  changeImageText: {color: '#fff', fontWeight: '600', fontSize: 13},
  analyzeButton: {
    backgroundColor: PURPLE,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  analyzeButtonText: {color: '#fff', fontSize: 17, fontWeight: '700'},
  analyzingRow: {flexDirection: 'row', alignItems: 'center'},
  disabledButton: {opacity: 0.5},
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  errorText: {color: '#B91C1C', fontSize: 14},

  // Result
  resultImage: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    resizeMode: 'cover',
    marginBottom: 16,
  },
  totalCard: {
    backgroundColor: PURPLE,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  totalLabel: {color: '#DDD6FE', fontSize: 14, fontWeight: '600'},
  totalPrice: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '800',
    marginTop: 4,
  },
  confidenceBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
  },
  confidenceText: {color: '#fff', fontSize: 13, fontWeight: '600'},

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
  cardTitle: {fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 14},
  subTitle: {fontSize: 14, fontWeight: '600', color: '#6B7280', marginBottom: 8, marginTop: 4},
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  breakdownLabel: {fontSize: 14, color: '#374151'},
  breakdownValue: {fontSize: 14, color: '#374151', fontWeight: '600'},
  elementLabel: {fontSize: 13, color: '#6B7280', flex: 1},
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 10,
  },
  grandTotalRow: {
    paddingTop: 10,
  },
  grandTotalLabel: {fontSize: 16, fontWeight: '800', color: PURPLE},
  grandTotalValue: {fontSize: 16, fontWeight: '800', color: PURPLE},
  reasoningText: {fontSize: 14, color: '#4B5563', lineHeight: 22},
  warningCard: {backgroundColor: '#FFFBEB'},
  warningTitle: {fontSize: 14, fontWeight: '700', color: '#92400E', marginBottom: 8},
  warningText: {fontSize: 13, color: '#92400E', lineHeight: 20},
});

export default App;
