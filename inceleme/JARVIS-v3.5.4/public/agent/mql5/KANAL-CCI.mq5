//+------------------------------------------------------------------+
//| KANAL-CCI.mq5                                                    |
//| TradingView "KANAL-CCI" göstergesinin MT5 (MQL5) çevirisi        |
//+------------------------------------------------------------------+
#property copyright "KANAL-CCI"
#property version   "1.00"
#property description "CCI + MA, trend renk değişimi ve alarm"
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots   2

//--- Plot 0: CCI çizgisi (renkli)
#property indicator_label1  "CCI Line"
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_color1  clrGray, clrLime, clrRed
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2

//--- Plot 1: CCI MA çizgisi
#property indicator_label2  "CCI MA Line"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrPurple
#property indicator_style2  STYLE_SOLID
#property indicator_width2  2

//--- Enum tanımları
enum ENUM_KC_PRICE
{
   P_CLOSE,            // Close
   P_OPEN,             // Open
   P_HIGH,             // High
   P_LOW,              // Low
   P_MEDIAN,           // Median
   P_TYPICAL,          // Typical
   P_WEIGHTED,         // Weighted
   P_AVERAGE,          // Average
   P_MEDIAN_BODY,      // Median body
   P_TREND_BIASED,     // Trend biased
   P_TREND_BIASED_EXT  // Trend biased (extreme)
};

enum ENUM_KC_MA
{
   MAM_SIMPLE,         // Simple MA
   MAM_EXPONENTIAL,    // Exponential MA
   MAM_SMOOTHED,       // Smoothed MA
   MAM_LINEAR          // Linear weighted MA
};

enum ENUM_KC_MODE
{
   CM_SLOPE,           // Change color on slope change
   CM_OBOS,            // Change color on ob/os cross
   CM_MA_CROSS         // Change color on ma cross
};

//--- Giriş parametreleri
input group "CCI Ayarları"
input ENUM_TIMEFRAMES InpTimeframe = PERIOD_CURRENT;  // Time frame
input int              InpCciPeriod = 34;             // CCI period
input ENUM_KC_PRICE    InpCciPrice  = P_TYPICAL;      // CCI price

input group "MA Ayarları"
input int              InpMaPeriod  = 21;             // CCI MA period
input ENUM_KC_MA       InpMaMethod  = MAM_SIMPLE;     // Average type

input group "Görünüm & Seviyeler"
input ENUM_KC_MODE     InpColorMode = CM_MA_CROSS;    // Color change
input double           InpOverSold   = -200;          // Oversold level
input double           InpOverBought = 200;           // Overbought level
input color            InpOsColor    = clrLime;       // Oversold color
input color            InpObColor    = clrRed;        // Overbought color
input color            InpMaColor    = clrPurple;     // CCI MA color

input group "Alarm Ayarları"
input bool             InpAlertsOn  = true;           // Turn alerts on?
input bool             InpAlertsCur = false;          // Alerts on current bar?

input group "Performans"
input int              InpMaxBars   = 5000;           // Max hesaplama barı (üst TF)

//--- Tamponlar
double BufCci[];
double BufColor[];
double BufMa[];

datetime g_lastAlertTime = 0;

//+------------------------------------------------------------------+
//| Fiyat seçimi                                                     |
//+------------------------------------------------------------------+
double CalcPrice(const ENUM_KC_PRICE t, const double o, const double h, const double l, const double c)
{
   switch(t)
   {
      case P_CLOSE:            return c;
      case P_OPEN:             return o;
      case P_HIGH:             return h;
      case P_LOW:              return l;
      case P_MEDIAN:           return (h + l) / 2.0;
      case P_TYPICAL:          return (h + l + c) / 3.0;
      case P_WEIGHTED:         return (h + l + c * 2.0) / 4.0;
      case P_AVERAGE:          return (h + l + c + o) / 4.0;
      case P_MEDIAN_BODY:      return (o + c) / 2.0;
      case P_TREND_BIASED:     return (c > o) ? (h + c) / 2.0 : (l + c) / 2.0;
      case P_TREND_BIASED_EXT: return (c > o) ? h : ((c < o) ? l : c);
   }
   return c;
}

//+------------------------------------------------------------------+
//| CCI hesabı (kronolojik sıra: index 0 = en eski)                  |
//+------------------------------------------------------------------+
void CalcCci(const double &p[], const int n, const int period, double &out[])
{
   ArrayResize(out, n);
   for(int i = 0; i < n; i++)
   {
      out[i] = EMPTY_VALUE;
      if(i < period - 1) continue;

      double sum = 0.0;
      for(int k = 0; k < period; k++) sum += p[i - k];
      double sma = sum / period;

      double dev = 0.0;
      for(int k = 0; k < period; k++) dev += MathAbs(p[i - k] - sma);
      dev /= period;

      out[i] = (dev != 0.0) ? (p[i] - sma) / (0.015 * dev) : 0.0;
   }
}

//+------------------------------------------------------------------+
//| Hareketli ortalama (Pine ta.sma / ema / rma / wma davranışı)     |
//+------------------------------------------------------------------+
void CalcMa(const double &src[], const int n, const int period, const ENUM_KC_MA method, double &out[])
{
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;

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
      case MAM_SIMPLE:
      {
         for(int i = seed; i < n; i++)
         {
            double sum = 0.0;
            for(int k = 0; k < period; k++) sum += src[i - k];
            out[i] = sum / period;
         }
         break;
      }
      case MAM_LINEAR:
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
      case MAM_EXPONENTIAL:
      case MAM_SMOOTHED:
      {
         double alpha = (method == MAM_EXPONENTIAL) ? 2.0 / (period + 1.0) : 1.0 / period;
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
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, BufCci,   INDICATOR_DATA);
   SetIndexBuffer(1, BufColor, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, BufMa,    INDICATOR_DATA);

   IndicatorSetString(INDICATOR_SHORTNAME, "KANAL-CCI");
   IndicatorSetInteger(INDICATOR_DIGITS, 2);

   // Renkler (kullanıcı girişine göre)
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, clrGray);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, InpOsColor);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 2, InpObColor);
   PlotIndexSetInteger(1, PLOT_LINE_COLOR, 0, InpMaColor);

   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   // Yatay seviyeler: OB, OS, 0
   IndicatorSetInteger(INDICATOR_LEVELS, 3);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpOverBought);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 0, clrRed);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 0, STYLE_DASH);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, InpOverSold);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 1, clrLime);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 1, STYLE_DASH);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, 0.0);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 2, clrGray);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 2, STYLE_SOLID);

   return INIT_SUCCEEDED;
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
   if(rates_total < 3) return 0;

   // Zaman dilimi: boşsa mevcut grafik
   ENUM_TIMEFRAMES htf = (InpTimeframe == PERIOD_CURRENT) ? Period() : InpTimeframe;
   if(PeriodSeconds(htf) < PeriodSeconds(Period()))
   {
      Print("KANAL-CCI: Seçilen zaman dilimi grafikten küçük, mevcut zaman dilimi kullanılıyor.");
      htf = Period();
   }
   bool sameTf = (htf == Period());

   // Üst zaman dilimi verileri (kronolojik sıra)
   int avail = Bars(_Symbol, htf);
   int n = MathMin(avail, InpMaxBars);
   if(n < InpCciPeriod + InpMaPeriod + 2) return 0;

   double ho[], hh[], hl[], hc[];
   ArraySetAsSeries(ho, false);
   ArraySetAsSeries(hh, false);
   ArraySetAsSeries(hl, false);
   ArraySetAsSeries(hc, false);
   int c1 = CopyOpen (_Symbol, htf, 0, n, ho);
   int c2 = CopyHigh (_Symbol, htf, 0, n, hh);
   int c3 = CopyLow  (_Symbol, htf, 0, n, hl);
   int c4 = CopyClose(_Symbol, htf, 0, n, hc);
   n = MathMin(MathMin(c1, c2), MathMin(c3, c4));
   if(n <= 0) return 0;

   double price[];
   ArrayResize(price, n);
   for(int i = 0; i < n; i++)
      price[i] = CalcPrice(InpCciPrice, ho[i], hh[i], hl[i], hc[i]);

   double hCci[], hMa[];
   CalcCci(price, n, InpCciPeriod, hCci);
   CalcMa(hCci, n, InpMaPeriod, InpMaMethod, hMa);

   // Grafik barlarına eşleme (lookahead kapalı: üst TF'de bir önceki kapanmış bar)
   double cCci[], cMa[];
   ArrayResize(cCci, rates_total);
   ArrayResize(cMa, rates_total);
   for(int i = 0; i < rates_total; i++)
   {
      cCci[i] = EMPTY_VALUE;
      cMa[i]  = EMPTY_VALUE;
      int idx = -1;
      if(sameTf)
      {
         int hs = rates_total - 1 - i;
         idx = n - 1 - hs;
      }
      else
      {
         int sh = iBarShift(_Symbol, htf, time[i], false);
         if(sh >= 0) idx = n - 1 - (sh + 1);
      }
      if(idx >= 0 && idx < n)
      {
         cCci[i] = hCci[idx];
         cMa[i]  = hMa[idx];
      }
   }

   // Trend / renk mantığı (Pine'daki var int trend ile aynı)
   int trd[];
   ArrayResize(trd, rates_total);
   int trend = 0;
   for(int i = 0; i < rates_total; i++)
   {
      double cc = cCci[i];
      double ma = cMa[i];
      bool vc = (cc != EMPTY_VALUE);
      bool vm = (ma != EMPTY_VALUE);

      if(vc)
      {
         switch(InpColorMode)
         {
            case CM_SLOPE:
            {
               double prev = (i > 0 && cCci[i - 1] != EMPTY_VALUE) ? cCci[i - 1] : 0.0;
               if(cc > prev)      trend = 1;
               else if(cc < prev) trend = -1;
               break;
            }
            case CM_MA_CROSS:
            {
               if(vm)
               {
                  if(cc > ma)      trend = 1;
                  else if(cc < ma) trend = -1;
               }
               break;
            }
            case CM_OBOS:
            {
               if(cc > InpOverBought)                              trend = -1;
               else if(cc < InpOverSold)                           trend = 1;
               else if(cc > InpOverSold && cc < InpOverBought)     trend = 0;
               break;
            }
         }
      }

      trd[i]       = trend;
      BufCci[i]    = cc;
      BufMa[i]     = ma;
      BufColor[i]  = (trend == 1) ? 1.0 : ((trend == -1) ? 2.0 : 0.0);
   }

   // Alarm: Pine'daki triggerCondition ile aynı
   int last = rates_total - 1;
   bool trig;
   int  barIdx;
   if(InpAlertsCur)
   {
      trig   = (trd[last] != trd[last - 1]);
      barIdx = last;
   }
   else
   {
      trig   = (trd[last - 1] != trd[last - 2]);
      barIdx = last - 1;
   }

   if(prev_calculated == 0)
      g_lastAlertTime = time[barIdx];          // geçmiş barlar için alarm verme
   else if(trig && time[barIdx] != g_lastAlertTime)
   {
      g_lastAlertTime = time[barIdx];
      if(InpAlertsOn)
         Alert("CCI_nrp Alert: Trend changed on " + _Symbol);
   }

   return rates_total;
}
//+------------------------------------------------------------------+
