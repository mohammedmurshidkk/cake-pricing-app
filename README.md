# Cake Pricing Mobile App (React Native)

A mobile application built with React Native (using the same architecture/specification as [PrintProxyAppBeta](file:///Users/kiebot/my-work/lab/relayet/PrintProxyAppBeta)) to calculate custom cake pricing from images using AI and configurable business rules.

---

## 📱 App Structure & Flow

```
+---------------------------------------+
|              HOME SCREEN              |
|                                       |
|  [ 📸 Calculate Price ] (Camera/Upload)|
|  [ 🖼️ Pick from Gallery ]             |
|                                       |
|  [ ⚙️ Settings ]                      |
+---------------------------------------+
                   |
                   v
+---------------------------------------+
|        CALCULATE PRICE SCREEN         |
|                                       |
|  - Camera / Gallery image picker      |
|  - Cake Image Preview                 |
|  - [ 🤖 Analyze & Calculate Price ]   |
+---------------------------------------+
                   |
                   v
+---------------------------------------+
|             RESULT SCREEN             |
|                                       |
|  - Image Preview                      |
|  - 💰 Grand Total (₹)                 |
|  - Confidence & Complexity Badge      |
|  - Itemized Breakdown:                |
|      * Base Price (Flavor + Weight)   |
|      * Design Elements (Unit/Fixed)   |
|  - AI Analysis & Warnings             |
|  - [ Calculate Another Cake ]         |
+---------------------------------------+
                   |
                   v (via Home)
+---------------------------------------+
|            SETTINGS SCREEN            |
|                                       |
|  1. ⚙️ General: Gemini API Key        |
|  2. 🍰 Flavors: Flavor & Size CRUD    |
|      * Base anchor selection          |
|      * Multi-size support (500g, 1kg) |
|  3. 🎨 Design Elements: Element CRUD  |
|      * Fixed vs. Per Unit pricing     |
|      * 20 standard preset elements    |
+---------------------------------------+
```

---

## 🧮 Pricing Engine Formula

The app uses the exact pricing engine from `whatsapp-order-system` and `cafe-admin-panel`:

$$\mathbf{\text{Grand Total}} = \mathbf{\text{Base Price (Flavor + Weight)}} + \sum (\mathbf{\text{Design Element Price}} \times \mathbf{\text{Quantity}})$$

1. **Base Price Extrapolation**:
   $$\text{Base Price} = \text{Math.round}\left(\frac{\text{Base Size Price}}{\text{Base Size Grams}} \times \text{Requested Grams}\right)$$
2. **Server-Side Repricing Protection**:
   AI detects *which* elements exist and their quantities, but prices are dynamically computed from your local configured price book to prevent hallucinated prices.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
cd CakePricingApp
npm install
```

### 2. Run Android / iOS
```bash
# Android
npm run android

# iOS
npm run ios
```

### 3. Configure Gemini API Key
1. Open the app and tap **⚙️ Settings** on the bottom of the home screen.
2. Under **General**, paste your Google Gemini API Key.
3. Under **Flavors** and **Elements**, tap **Load Defaults** to instantly seed preset flavor and design element price tiers.
