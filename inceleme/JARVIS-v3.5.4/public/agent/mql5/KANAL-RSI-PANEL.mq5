//+------------------------------------------------------------------+
//| KANAL-RSI-PANEL.mq5                                              |
//| TradingView "KANAL-RSI PANEL" göstergesinin MT5 (MQL5) çevirisi  |
//+------------------------------------------------------------------+
#property copyright "KANAL-RSI PANEL"
#property version   "1.00"
#property description "RSI + çoklu zaman dilimi RSI paneli"
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_buffers 2
#property indicator_plots   1

//--- Plot 0: Ana RSI çizgisi (renkli)
#property indicator_label1  "Ana RSI"
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_color1  clrGray, clrLime, clrRed
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2

//--- Enum tanımları
enum ENUM_KRSI_POS
{
   POS_TL,   // Top Left
   POS_TR,   // Top Right
   POS_BL,   // Bottom Left
   POS_BR    // Bottom Right
};

//--- Giriş parametreleri
input group "RSI Ayarları"
input int                InpRsiPeriod = 14;            // RSI Periyodu
input ENUM_APPLIED_PRICE InpSource    = PRICE_CLOSE;   // RSI Fiyat Tipi

input group "Seviyeler"
input double             InpLevel70   = 70.0;          // Üst Seviye (Aşırı Alım)
input double             InpLevel30   = 30.0;          // Alt Seviye (Aşırı Satım)

input group "Görsel Ayarlar"
input int                InpLineWidth = 2;             // RSI Çizgi Kalınlığı (1-5)

input group "Panel Görünümü"
input ENUM_KRSI_POS      InpPanelPos  = POS_TR;        // Panel Konumu

//--- Tamponlar
double BufRsi[];
double BufColor[];

//--- Panel sabitleri
const string PFX     = "KRSIP_";
const int    CELL_W  = 72;
const int    CELL_H  = 26;
const int    MARGIN  = 10;

//+------------------------------------------------------------------+
//| Uygulanan fiyat                                                  |
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
//| Wilder RSI (Pine ta.rsi ile aynı: RMA tabanlı)                   |
//| Dizi kronolojik sıralı: index 0 = en eski                        |
//+------------------------------------------------------------------+
double RsiFromAvg(const double up, const double down)
{
   if(down == 0.0) return 100.0;
   if(up == 0.0)   return 0.0;
   return 100.0 - 100.0 / (1.0 + up / down);
}

void CalcRsi(const double &p[], const int n, const int period, double &out[])
{
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   if(period < 1 || n <= period) return;

   double sumU = 0.0, sumD = 0.0;
   for(int i = 1; i <= period; i++)
   {
      double ch = p[i] - p[i - 1];
      sumU += MathMax(ch, 0.0);
      sumD += MathMax(-ch, 0.0);
   }
   double avgU = sumU / period;
   double avgD = sumD / period;
   out[period] = RsiFromAvg(avgU, avgD);

   for(int i = period + 1; i < n; i++)
   {
      double ch = p[i] - p[i - 1];
      avgU = (avgU * (period - 1) + MathMax(ch, 0.0))  / period;
      avgD = (avgD * (period - 1) + MathMax(-ch, 0.0)) / period;
      out[i] = RsiFromAvg(avgU, avgD);
   }
}

//+------------------------------------------------------------------+
//| Belirli zaman dilimi için son RSI değeri (lookahead kapalı)      |
//| Aynı TF ise forming bar, farklı TF ise son kapanmış bar          |
//+------------------------------------------------------------------+
double GetHtfLastRsi(const ENUM_TIMEFRAMES tf, const ENUM_APPLIED_PRICE ap, const int period)
{
   int avail = Bars(_Symbol, tf);
   if(avail <= period + 1) return EMPTY_VALUE;
   int cnt = MathMin(avail, 1500);

   double o[], h[], l[], c[];
   ArraySetAsSeries(o, false);
   ArraySetAsSeries(h, false);
   ArraySetAsSeries(l, false);
   ArraySetAsSeries(c, false);
   int k1 = CopyOpen (_Symbol, tf, 0, cnt, o);
   int k2 = CopyHigh (_Symbol, tf, 0, cnt, h);
   int k3 = CopyLow  (_Symbol, tf, 0, cnt, l);
   int k4 = CopyClose(_Symbol, tf, 0, cnt, c);
   int n = MathMin(MathMin(k1, k2), MathMin(k3, k4));
   if(n <= period + 1) return EMPTY_VALUE;

   double p[];
   ArrayResize(p, n);
   for(int i = 0; i < n; i++)
      p[i] = ApplyPrice(ap, o[i], h[i], l[i], c[i]);

   double r[];
   CalcRsi(p, n, period, r);

   int idx = (tf == Period()) ? n - 1 : n - 2;
   if(idx < 0) return EMPTY_VALUE;
   return r[idx];
}

//+------------------------------------------------------------------+
//| Panel: hücre merkezi koordinatı                                  |
//+------------------------------------------------------------------+
void CellCenter(const int r, const int c, const bool right, const bool lower, int &x, int &y)
{
   int col = right ? (6 - c) : c;
   x = MARGIN + col * CELL_W + CELL_W / 2;
   y = lower ? MARGIN + (1 - r) * CELL_H + CELL_H / 2
             : MARGIN + r * CELL_H + CELL_H / 2;
}

//+------------------------------------------------------------------+
//| Panel: grafik nesnelerini oluştur                                |
//+------------------------------------------------------------------+
void CreatePanel()
{
   bool right = (InpPanelPos == POS_TR || InpPanelPos == POS_BR);
   bool lower = (InpPanelPos == POS_BL || InpPanelPos == POS_BR);

   ENUM_BASE_CORNER corner;
   if(!right && !lower)      corner = CORNER_LEFT_UPPER;
   else if(right && !lower)  corner = CORNER_RIGHT_UPPER;
   else if(!right && lower)  corner = CORNER_LEFT_LOWER;
   else                      corner = CORNER_RIGHT_LOWER;

   string headers[7] = {"M1", "M5", "M15", "M30", "H1", "H4", "D1"};

   for(int r = 0; r < 2; r++)
   {
      for(int c = 0; c < 7; c++)
      {
         int x, y;
         CellCenter(r, c, right, lower, x, y);

         // Arka plan dikdörtgeni
         string bg = PFX + "bg_" + IntegerToString(r) + "_" + IntegerToString(c);
         ObjectDelete(0, bg);
         ObjectCreate(0, bg, OBJ_RECTANGLE_LABEL, 0, 0, 0);
         ObjectSetInteger(0, bg, OBJPROP_CORNER, corner);
         ObjectSetInteger(0, bg, OBJPROP_ANCHOR, ANCHOR_CENTER);
         ObjectSetInteger(0, bg, OBJPROP_XDISTANCE, x);
         ObjectSetInteger(0, bg, OBJPROP_YDISTANCE, y);
         ObjectSetInteger(0, bg, OBJPROP_XSIZE, CELL_W);
         ObjectSetInteger(0, bg, OBJPROP_YSIZE, CELL_H);
         ObjectSetInteger(0, bg, OBJPROP_BGCOLOR, (r == 0) ? C'30,30,30' : C'12,12,12');
         ObjectSetInteger(0, bg, OBJPROP_BORDER_TYPE, BORDER_FLAT);
         ObjectSetInteger(0, bg, OBJPROP_COLOR, C'80,80,80');
         ObjectSetInteger(0, bg, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, bg, OBJPROP_HIDDEN, true);

         // Metin
         string tx = PFX + "tx_" + IntegerToString(r) + "_" + IntegerToString(c);
         ObjectDelete(0, tx);
         ObjectCreate(0, tx, OBJ_LABEL, 0, 0, 0);
         ObjectSetInteger(0, tx, OBJPROP_CORNER, corner);
         ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_CENTER);
         ObjectSetInteger(0, tx, OBJPROP_XDISTANCE, x);
         ObjectSetInteger(0, tx, OBJPROP_YDISTANCE, y);
         ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 11);
         ObjectSetString (0, tx, OBJPROP_FONT, "Consolas");
         ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
         if(r == 0)
         {
            ObjectSetString (0, tx, OBJPROP_TEXT, headers[c]);
            ObjectSetInteger(0, tx, OBJPROP_COLOR, clrYellow);
         }
         else
         {
            ObjectSetString (0, tx, OBJPROP_TEXT, "N/A");
            ObjectSetInteger(0, tx, OBJPROP_COLOR, clrWhite);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Panel: değer hücresini güncelle                                  |
//+------------------------------------------------------------------+
void SetCell(const int c, const double v)
{
   string tx = PFX + "tx_1_" + IntegerToString(c);
   bool valid = (v != EMPTY_VALUE);
   string txt = valid ? DoubleToString(v, 2) : "N/A";
   color clr  = !valid ? clrWhite : (v >= InpLevel70 ? clrRed : (v <= InpLevel30 ? clrLime : clrWhite));
   ObjectSetString (0, tx, OBJPROP_TEXT, txt);
   ObjectSetInteger(0, tx, OBJPROP_COLOR, clr);
}

//+------------------------------------------------------------------+
//| Init                                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpRsiPeriod < 1) return INIT_PARAMETERS_INCORRECT;

   SetIndexBuffer(0, BufRsi,   INDICATOR_DATA);
   SetIndexBuffer(1, BufColor, INDICATOR_COLOR_INDEX);

   IndicatorSetString(INDICATOR_SHORTNAME, "KANAL-RSI PANEL");
   IndicatorSetInteger(INDICATOR_DIGITS, 2);

   PlotIndexSetString(0, PLOT_LABEL, "Ana RSI");
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 0, clrGray);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 1, clrLime);
   PlotIndexSetInteger(0, PLOT_LINE_COLOR, 2, clrRed);
   PlotIndexSetInteger(0, PLOT_LINE_WIDTH, MathMax(1, MathMin(5, InpLineWidth)));
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   // Seviyeler: 70 (kırmızı kesik), 30 (lime kesik)
   IndicatorSetInteger(INDICATOR_LEVELS, 2);
   IndicatorSetDouble (INDICATOR_LEVELVALUE, 0, InpLevel70);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 0, clrRed);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 0, STYLE_DASH);
   IndicatorSetInteger(INDICATOR_LEVELWIDTH, 0, 1);
   IndicatorSetDouble (INDICATOR_LEVELVALUE, 1, InpLevel30);
   IndicatorSetInteger(INDICATOR_LEVELCOLOR, 1, clrLime);
   IndicatorSetInteger(INDICATOR_LEVELSTYLE, 1, STYLE_DASH);
   IndicatorSetInteger(INDICATOR_LEVELWIDTH, 1, 1);

   CreatePanel();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Deinit: paneli temizle                                           |
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
   if(rates_total <= InpRsiPeriod) return 0;

   // Ana grafik RSI
   double price[];
   ArrayResize(price, rates_total);
   for(int i = 0; i < rates_total; i++)
      price[i] = ApplyPrice(InpSource, open[i], high[i], low[i], close[i]);

   CalcRsi(price, rates_total, InpRsiPeriod, BufRsi);

   for(int i = 0; i < rates_total; i++)
   {
      double v = BufRsi[i];
      if(v == EMPTY_VALUE)           BufColor[i] = 0;
      else if(v >= InpLevel70)       BufColor[i] = 2;   // kırmızı
      else if(v <= InpLevel30)       BufColor[i] = 1;   // lime
      else                           BufColor[i] = 0;   // gri
   }

   // Çoklu zaman dilimi paneli
   SetCell(0, GetHtfLastRsi(PERIOD_M1,  InpSource, InpRsiPeriod));
   SetCell(1, GetHtfLastRsi(PERIOD_M5,  InpSource, InpRsiPeriod));
   SetCell(2, GetHtfLastRsi(PERIOD_M15, InpSource, InpRsiPeriod));
   SetCell(3, GetHtfLastRsi(PERIOD_M30, InpSource, InpRsiPeriod));
   SetCell(4, GetHtfLastRsi(PERIOD_H1,  InpSource, InpRsiPeriod));
   SetCell(5, GetHtfLastRsi(PERIOD_H4,  InpSource, InpRsiPeriod));
   SetCell(6, GetHtfLastRsi(PERIOD_D1,  InpSource, InpRsiPeriod));

   return rates_total;
}
//+------------------------------------------------------------------+
