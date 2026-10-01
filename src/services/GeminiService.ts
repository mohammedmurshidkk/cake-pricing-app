import {AppConfig, CakeAnalysisResult} from '../types';
import {calculateBasePrice, repriceElements} from '../utils/pricing';

const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Analyze a cake image using Gemini Vision API.
 * After AI returns detected elements, we re-price using local config
 * so hallucinated prices never reach the user.
 */
export async function analyzeCakeImage(
  imageBase64: string,
  mimeType: string,
  config: AppConfig,
): Promise<CakeAnalysisResult> {
  if (!config.gemini_api_key) {
    throw new Error('Gemini API key not configured. Go to Settings to add it.');
  }

  const flavorsText =
    config.flavors.length > 0
      ? config.flavors
          .filter(f => f.is_active)
          .map(f => {
            const sizes = f.sizes
              .map(s => `${s.name}: ₹${s.price}${s.is_base ? ' [BASE]' : ''}`)
              .join(', ');
            return `- ${f.flavor_name}: ${sizes}`;
          })
          .join('\n')
      : 'No flavor pricing configured.';

  const elementsText =
    config.design_elements.length > 0
      ? config.design_elements
          .filter(e => e.is_active)
          .map(
            e =>
              `- ${e.element_key} ("${e.element_label}"): ₹${e.price}${
                e.price_type === 'per_unit' ? ' per unit' : ''
              }`,
          )
          .join('\n')
      : 'No elements configured.';

  const prompt = `You are a cake pricing assistant for a bakery. Analyze the cake image and identify design elements to calculate pricing.

## Flavor + weight pricing:
${flavorsText}
For custom weights, calculate from the [BASE] size: (base_price / base_grams) × requested_grams.

## Available Design Elements to Detect (use these keys and prices only):
${elementsText}

## Rules:
- Only include elements you can clearly see; be conservative.
- If weight is not specified, assume 1000g. If flavor is unclear, pick the most likely one from the pricing list.
- base_price = flavor+weight price. design_elements_total = sum of detected element prices. grand_total = base_price + design_elements_total.
- Put any uncertainty in warnings.

## Response Format (JSON only, no markdown):
{
  "detected_elements": [
    {
      "element_key": "string",
      "element_label": "string",
      "quantity": number,
      "confidence": number,
      "unit_price": number,
      "total_price": number
    }
  ],
  "detected_flavor": "string",
  "detected_weight_grams": number,
  "complexity_level": "simple|moderate|elaborate|premium",
  "complexity_reasoning": "string",
  "price_breakdown": {
    "base_price": number,
    "design_elements_total": number,
    "grand_total": number
  },
  "confidence_score": number,
  "suggested_message": "string",
  "warnings": ["string"]
}

Return ONLY valid JSON, no markdown code blocks.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${config.gemini_api_key}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
              {text: prompt},
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  // Parse JSON from response
  let analysis: CakeAnalysisResult;
  const jsonStr = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  try {
    analysis = JSON.parse(jsonStr);
  } catch {
    // Try extracting JSON between first { and last }
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      analysis = JSON.parse(text.substring(startIdx, endIdx + 1));
    } else {
      throw new Error('Failed to parse Gemini response as JSON.');
    }
  }

  // ── Server-side re-pricing ──────────────────────────────
  // Trust AI detection of WHAT elements are present, but override
  // prices from our local config so hallucinated numbers never leak.
  if (analysis.detected_elements && config.design_elements.length > 0) {
    analysis.detected_elements = repriceElements(
      analysis.detected_elements,
      config.design_elements,
    );
  }

  // Re-calculate base price from config
  if (analysis.detected_flavor && config.flavors.length > 0) {
    const flavorName = analysis.detected_flavor.toLowerCase().trim();
    const matchedFlavor =
      config.flavors.find(f => f.flavor_name.toLowerCase() === flavorName) ||
      config.flavors.find(
        f =>
          f.flavor_name.toLowerCase().includes(flavorName) ||
          flavorName.includes(f.flavor_name.toLowerCase()),
      );
    if (matchedFlavor) {
      const weightGrams = analysis.detected_weight_grams || 1000;
      analysis.price_breakdown.base_price = calculateBasePrice(
        matchedFlavor,
        weightGrams,
      );
    }
  }

  // Re-calculate totals
  const elementsTotal = (analysis.detected_elements || []).reduce(
    (sum, el) => sum + el.total_price,
    0,
  );
  analysis.price_breakdown.design_elements_total = elementsTotal;
  analysis.price_breakdown.grand_total =
    analysis.price_breakdown.base_price + elementsTotal;

  return analysis;
}
