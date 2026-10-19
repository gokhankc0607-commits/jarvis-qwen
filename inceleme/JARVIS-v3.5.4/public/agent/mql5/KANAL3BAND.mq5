//+------------------------------------------------------------------+
//| KANAL3BAND.mq5                                                   |
//| TradingView "KANAL3BAND" göstergesinin MT5 (MQL5) çevirisi       |
//| Centered YSR merkez çizgisi + 3 ATR bant çifti + 3 MA            |
//+------------------------------------------------------------------+
#property copyright "KANAL3BAND"
#property version   "1.00"
#property description "Centered YSR + 3 ATR bant seti + 3 hareketli ortalama"
#property indicator_chart_window
#property indicator_buffers 11
#property indicator_plots   10

//--- Plot 0: Centered YSR (renk indeksli: 0 = Bear, 1 = Bull)
#property indicator_label1  "Centered YSR"
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_color1  C'41,98,255', C'41,98,255'
#property indicator_style1  STYLE_SOLID
#property indicator_width1  1

//--- Plot 1-3: üst bantlar
#property indicator_label2  "Up Band 1"
#property indicator_type2   DRAW_LINE
#property indicator_color2  C'255,82,82'
#property indicator_width2  1
#property indicator_label3  "Up Band 2"
#property indicator_type3   DRAW_LINE
#property indicator_color3  C'255,82,82'
#property indicator_width3  1
#property indicator_label4  "Up Band 3"
#property indicator_type4   DRAW_LINE
#property indicator_color4  C'255,82,82'
#property indicator_width4  1

//--- Plot 4-6: alt bantlar
#property indicator_label5  "Down Band 1"
#property indicator_type5   DRAW_LINE
#property indicator_color5  C'0,230,118'
#property indicator_width5  1
#property indicator_label6  "Down Band 2"
#property indicator_type6   DRAW_LINE
#property indicator_color6  C'0,230,118'
#property indicator_width6  1
#property indicator_label7  "Down Band 3"
#property indicator_type7   DRAW_LINE
#property indicator_color7  C'0,230,118'
#property indicator_width7  1

//--- Plot 7-9: MA 1-3
#property indicator_label8  "MA 1"
#property indicator_type8   DRAW_LINE
#property indicator_color8  clrOrange
#property indicator_width8  1
#property indicator_label9  "MA 2"
#property indicator_type9   DRAW_LINE
#property indicator_color9  clrYellow
#property indicator_width9  1
#property indicator_label10 "MA 3"
#property indicator_type10  DRAW_LINE
#property indicator_color10 clrPurple
#property indicator_width10 1

//--- Enum tanımları
enum ENUM_KB_PRICE
{
   PB_CLOSE,       // Close
   PB_OPEN,        // Open
   PB_HIGH,        // High
   PB_LOW,         // Low
   PB_MEDIAN,      // Median
   PB_TYPICAL,     // Typical
   PB_WEIGHTED,    // Weighted
   PB_AVERAGE      // Average
};

enum ENUM_KB_MA
{
   MAB_EXPONENTIAL, // Exponential
   MAB_SIMPLE,      // Simple
   MAB_SMOOTHED,    // Smoothed
   MAB_LINEAR       // Linear Weighted
};

//--- Giriş parametreleri
input group "Centered ATR Ayarları"
input int                InpHalfLength  = 60;             // Centered ATR Half Period
input ENUM_KB_PRICE      InpPriceType   = PB_WEIGHTED;    // Price to Use
input int                InpAtrPeriod   = 100;            // Average True Range Period
input double             InpAtrMult1    = 4.2;            // ATR Multiplier 1
input double             InpAtrMult2    = 3.5;            // ATR Multiplier 2
input double             InpAtrMult3    = 2.8;            // ATR Multiplier 3

input group "Renkler"
input color              InpColorDown      = C'41,98,255';   // Bear
input color              InpColorUp        = C'41,98,255';   // Bull
input color              InpColorUpBands   = C'255,82,82';   // Up Bands
input color              InpColorDownBands = C'0,230,118';   // Down Bands

input group "Hareketli Ortalama 1"
input bool               InpMa1On    = false;                // MA 1 Aç/Kapat
input ENUM_KB_MA         InpMa1Type  = MAB_EXPONENTIAL;      // MA 1 Türü
input int                InpMa1Len   = 20;                   // MA 1 Uzunluğu
input ENUM_APPLIED_PRICE InpMa1Src   = PRICE_CLOSE;          // MA 1 Kaynağı
input color              InpMa1Color = clrOrange;            // MA 1 Rengi
input int                InpMa1Width = 1;                    // MA 1 Kalınlığı

input group "Hareketli Ortalama 2"
input bool               InpMa2On    = false;                // MA 2 Aç/Kapat
input ENUM_KB_MA         InpMa2Type  = MAB_EXPONENTIAL;      // MA 2 Türü
input int                InpMa2Len   = 50;                   // MA 2 Uzunluğu
input ENUM_APPLIED_PRICE InpMa2Src   = PRICE_CLOSE;          // MA 2 Kaynağı
input color              InpMa2Color = clrYellow;            // MA 2 Rengi
input int                InpMa2Width = 1;                    // MA 2 Kalınlığı

input group "Hareketli Ortalama 3"
input bool               InpMa3On    = false;                // MA 3 Aç/Kapat
input ENUM_KB_MA         InpMa3Type  = MAB_EXPONENTIAL;      // MA 3 Türü
input int                InpMa3Len   = 200;                  // MA 3 Uzunluğu
input ENUM_APPLIED_PRICE InpMa3Src   = PRICE_CLOSE;          // MA 3 Kaynağı
input color              InpMa3Color = clrPurple;            // MA 3 Rengi
input int                InpMa3Width = 1;                    // MA 3 Kalınlığı

input group "Diğer"
input bool               InpWatermark = false;                // Alt sol yazıyı göster

//--- Tamponlar
double BufC[];        // Centered YSR
double BufCColor[];   // Centered YSR renk indeksi
double BufU1[], BufU2[], BufU3[];
double BufD1[], BufD2[], BufD3[];
double BufM1[], BufM2[], BufM3[];

const string PFX = "KANAL3BAND_";

//+------------------------------------------------------------------+
//| Uygulanan fiyat (MA kaynağı için)                                |
//+------------------------------------------------------------------+
double ApplyPrice(const ENUM_APPLIED_PRICE ap,
                  const double o, const double h, const double l, const double c)
{
   switch(ap)
   {
      case PRICE_OPEN:     return o;
      case PRICE_HIGH:     return h;
      case PRICE_LOW:      return l;
      case PRICE_MEDIAN:   return (h + l) / 2.0;
      case PRICE_TYPICAL:  return (h + l + c) / 3.0;
      case PRICE_WEIGHTED: return (h + l + c * 2.0) / 4.0;
      default:             return c;
   }
}

//+------------------------------------------------------------------+
//| Centered YSR için fiyat (Pine Price(x) fonksiyonu)               |
//+------------------------------------------------------------------+
double BandPrice(const ENUM_KB_PRICE t,
                 const double o, const double h, const double l, const double c)
{
   switch(t)
   {
      case PB_CLOSE:    return c;
      case PB_OPEN:     return o;
      case PB_HIGH:     return h;
      case PB_LOW:      return l;
      case PB_MEDIAN:   return (h + l) / 2.0;
      case PB_TYPICAL:  return (h + l + c) / 3.0;
      case PB_WEIGHTED: return (h + l + c + c) / 4.0;
      case PB_AVERAGE:  return (h + l + c + o) / 4.0;
   }
   return c;
}

//+------------------------------------------------------------------+
//| Hareketli ortalama (kronolojik dizi: index 0 = en eski)          |
//| Pine ta.sma / ta.ema / ta.rma / ta.wma davranışı                 |
//+------------------------------------------------------------------+
void CalcMa(const double &src[], const int n, const int period,
            const ENUM_KB_MA method, double &out[])
{
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   if(period < 1 || n < period) return;

   int s = -1;
   for(int i = 0; i < n; i++)
   {
      if(src[i] != EMPTY_VALUE) { s = i; break; }
   }
   if(s < 0) return;

   int seed = s + period - 1;
   if(seed >= n) return;

   switch(method)
   {
      case MAB_SIMPLE:
      {
         for(int i = seed; i < n; i++)
         {
            double sum = 0.0;
            for(int k = 0; k < period; k++) sum += src[i - k];
            out[i] = sum / period;
         }
         break;
      }
      case MAB_LINEAR:
      {
         double denom = period * (period + 1) / 2.0;
         for(int i = seed; i < n; i++)
         {
            double sum = 0.0;
            for(int k = 0; k < period; k++) sum += src[i - period + 1 + k] * (k + 1);
            out[i] = sum / denom;
         }
         break;
      }
      case MAB_EXPONENTIAL:
      case MAB_SMOOTHED:
      {
         double alpha = (method == MAB_EXPONENTIAL) ? 2.0 / (period + 1.0) : 1.0 / period;
         double sum = 0.0;
         for(int k = 0; k < period; k++) sum += src[seed - k];
         out[seed] = sum / period;
         for(int i = seed + 1; i < n; i++)
            out[i] = alpha * src[i] + (1.0 - alpha) * out[i - 1];
         break;
      }
   }
}

//+------------------------------------------------------------------+
//| MA hesabı (açıksa), kapalıysa EMPTY                              |
//+------------------------------------------------------------------+
void CalcMaFromApplied(const bool on, const ENUM_APPLIED_PRICE ap, const int len,
                       const ENUM_KB_MA type,
                       const double &o[], const double &h[], const double &l[], const double &c[],
                       double &out[])
{
   int n = ArraySize(c);
   ArrayResize(out, n);
   if(!on || len < 1 || n == 0)
   {
      for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
      return;
   }
   double src[];
   ArrayResize(src, n);
   for(int i = 0; i < n; i++)
      src[i] = ApplyPrice(ap, o[i], h[i], l[i], c[i]);
   CalcMa(src, n, len, type, out);
}

//+------------------------------------------------------------------+
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpHalfLength < 1 || InpAtrPeriod < 1) return INIT_PARAMETERS_INCORRECT;

   SetIndexBuffer(0,  BufC,      INDICATOR_DATA);
   SetIndexBuffer(1,  BufCColor, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2,  BufU1,     INDICATOR_DATA);
   SetIndexBuffer(3,  BufU2,     INDICATOR_DATA);
   SetIndexBuffer(4,  BufU3,     INDICATOR_DATA);
   SetIndexBuffer(5,  BufD1,     INDICATOR_DATA);
   SetIndexBuffer(6,  BufD2,     INDICATOR_DATA);
   SetIndexBuffer(7,  BufD3,     INDICATOR_DATA);
   SetIndexBuffer(8,  BufM1,     INDICATOR_DATA);
   SetIndexBuffer(9,  BufM2,     INDICATOR_DATA);
   SetIndexBuffer(10, BufM3,     INDICATOR_DATA);

   IndicatorSetString(INDICATOR_SHORTNAME, "KANAL3BAND");
   IndicatorSetInteger(INDICATOR_DIGITS, _Digits);

   // Renkler (kullanıcı girişine göre)
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, InpColorDown);   // Bear
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, InpColorUp);     // Bull

   PlotIndexSetInteger(1, PLOT_LINE_COLOR, 0, InpColorUpBands);
   PlotIndexSetInteger(2, PLOT_LINE_COLOR, 0, InpColorUpBands);
   PlotIndexSetInteger(3, PLOT_LINE_COLOR, 0, InpColorUpBands);
   PlotIndexSetInteger(4, PLOT_LINE_COLOR, 0, InpColorDownBands);
   PlotIndexSetInteger(5, PLOT_LINE_COLOR, 0, InpColorDownBands);
   PlotIndexSetInteger(6, PLOT_LINE_COLOR, 0, InpColorDownBands);

   PlotIndexSetInteger(7, PLOT_LINE_COLOR, 0, InpMa1Color);
   PlotIndexSetInteger(8, PLOT_LINE_COLOR, 0, InpMa2Color);
   PlotIndexSetInteger(9, PLOT_LINE_COLOR, 0, InpMa3Color);

   PlotIndexSetInteger(7, PLOT_LINE_WIDTH, MathMax(1, InpMa1Width));
   PlotIndexSetInteger(8, PLOT_LINE_WIDTH, MathMax(1, InpMa2Width));
   PlotIndexSetInteger(9, PLOT_LINE_WIDTH, MathMax(1, InpMa3Width));

   for(int p = 0; p < 10; p++)
      PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   // Alt sol yazı (Pine'daki watermark tablosu)
   if(InpWatermark)
   {
      string wm = PFX + "WM";
      ObjectDelete(0, wm);
      ObjectCreate(0, wm, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, wm, OBJPROP_CORNER, CORNER_LEFT_LOWER);
      ObjectSetInteger(0, wm, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, wm, OBJPROP_XDISTANCE, 10);
      ObjectSetInteger(0, wm, OBJPROP_YDISTANCE, 10);
      ObjectSetInteger(0, wm, OBJPROP_FONTSIZE, 11);
      ObjectSetString (0, wm, OBJPROP_FONT, "Arial Bold");
      ObjectSetString (0, wm, OBJPROP_TEXT, "TRADE");
      ObjectSetInteger(0, wm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, wm, OBJPROP_HIDDEN, true);
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Deinit                                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, PFX);
}

//+------------------------------------------------------------------+
//| Ana hesap                                                        |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   int H = InpHalfLength;
   int P = InpAtrPeriod;
   if(rates_total < H + P + 12) return 0;

   // 1) Fiyat dizisi (Centered YSR için)
   double pr[];
   ArrayResize(pr, rates_total);
   for(int i = 0; i < rates_total; i++)
      pr[i] = BandPrice(InpPriceType, open[i], high[i], low[i], close[i]);

   // 2) Centered YSR: her bar için üçgen ağırlıklı merkezi ortalama
   //    Ağırlık: merkez H+1, merkezden j uzaklıkta H+1-j
   //    Geçmiş taraf her zaman, gelecek taraf (son bara kadar) kullanılır.
   double cy[];
   ArrayResize(cy, rates_total);
   for(int i = 0; i < rates_total; i++)
   {
      cy[i] = EMPTY_VALUE;
      if(i - H < 0) continue;

      double sum = (H + 1) * pr[i];
      double sw  = H + 1;
      int    k   = H;
      for(int j = 1; j <= H; j++)
      {
         sum += k * pr[i - j];
         sw  += k;
         if(i + j <= rates_total - 1)
         {
            sum += k * pr[i + j];
            sw  += k;
         }
         k--;
      }
      cy[i] = sum / sw;
   }

   // 3) ATR (Pine'daki özel tanım: TR'lerin basit ortalaması, 10 bar geriden)
   //    Bar i için: q = i-10-j, j = 0..P-1; TR(q) = max(H[q],C[q-1]) - min(L[q],C[q-1])
   double atr[];
   ArrayResize(atr, rates_total);
   for(int i = 0; i < rates_total; i++)
   {
      atr[i] = EMPTY_VALUE;
      if(i < P + 10) continue;

      double sum = 0.0;
      for(int j = 0; j < P; j++)
      {
         int q = i - 10 - j;
         double hi = MathMax(high[q], close[q - 1]);
         double lo = MathMin(low[q],  close[q - 1]);
         sum += hi - lo;
      }
      atr[i] = sum / P;
   }

   // 4) Çıkış tamponları + merkez renk durumu (Pine'daki var colorBuffer)
   int col = 0;   // 0 = Bear, 1 = Bull
   for(int i = 0; i < rates_total; i++)
   {
      if(i > 0 && cy[i] != EMPTY_VALUE && cy[i - 1] != EMPTY_VALUE)
      {
         if(cy[i] > cy[i - 1])      col = 1;
         else if(cy[i] < cy[i - 1]) col = 0;
      }
      BufCColor[i] = col;
      BufC[i]      = cy[i];

      if(cy[i] != EMPTY_VALUE && atr[i] != EMPTY_VALUE)
      {
         BufU1[i] = cy[i] + InpAtrMult1 * atr[i];
         BufU2[i] = cy[i] + InpAtrMult2 * atr[i];
         BufU3[i] = cy[i] + InpAtrMult3 * atr[i];
         BufD1[i] = cy[i] - InpAtrMult1 * atr[i];
         BufD2[i] = cy[i] - InpAtrMult2 * atr[i];
         BufD3[i] = cy[i] - InpAtrMult3 * atr[i];
      }
      else
      {
         BufU1[i] = EMPTY_VALUE; BufU2[i] = EMPTY_VALUE; BufU3[i] = EMPTY_VALUE;
         BufD1[i] = EMPTY_VALUE; BufD2[i] = EMPTY_VALUE; BufD3[i] = EMPTY_VALUE;
      }
   }

   // 5) Hareketli ortalamalar
   double m1[], m2[], m3[];
   CalcMaFromApplied(InpMa1On, InpMa1Src, InpMa1Len, InpMa1Type, open, high, low, close, m1);
   CalcMaFromApplied(InpMa2On, InpMa2Src, InpMa2Len, InpMa2Type, open, high, low, close, m2);
   CalcMaFromApplied(InpMa3On, InpMa3Src, InpMa3Len, InpMa3Type, open, high, low, close, m3);
   for(int i = 0; i < rates_total; i++)
   {
      BufM1[i] = m1[i];
      BufM2[i] = m2[i];
      BufM3[i] = m3[i];
   }

   // 6) Watermark rengi (Pine'daki yanıp sönen efekt)
   if(InpWatermark)
   {
      ObjectSetInteger(0, PFX + "WM", OBJPROP_COLOR,
                       ((TimeCurrent() % 2) == 0) ? clrRed : clrLime);
   }

   return rates_total;
}
//+------------------------------------------------------------------+
