//+------------------------------------------------------------------+
//| KANAL_Strateji.mq5                                               |
//| JARVIS - KANAL 5 aşamalı sıralı strateji                        |
//| M0: dış bant kapanışı + aynı mumda RSI bölgesi                  |
//| MR: dış bandın içine en az 0.10 ATR güvenli dönüş               |
//| Sonra RSI eşiği ve CCI/MA kesişimleri sırasıyla teyit edilir.    |
//| SL = kurulum ekstremi · TP = KANAL3BAND merkez çizgisi          |
//| TTL: M3/M5 10, M15 8, H1 6 kapanmış mum · R:R < 1:1 bloke      |
//| Piyasa Gözlemi'ndeki sembolleri tarar; varsayılan yalnızca uyarı.|
//| Merkez çizgi oluşmakta olan mumu içermez (sinyal titremez).     |
//+------------------------------------------------------------------+
#property copyright "JARVIS"
#property version   "3.23"
#property description "KANAL 5 aşama: M0+RSI, 0.10 ATR dönüş, RSI/CCI sıralı teyit, TTL ve R:R kapısı."

#include <Trade\Trade.mqh>

//--- Giriş parametreleri
input group "Zaman dilimleri (birden fazla seçilebilir)"
input bool            InpUseM3         = false;     // 3 dakika
input bool            InpUseM5         = true;      // 5 dakika
input bool            InpUseM15        = true;      // 15 dakika
input bool            InpUseH1         = false;     // 1 saat

input group "KANAL3BAND (merkez + ATR bantları)"
input int             InpHalfLength    = 60;        // Centered ATR Half Period
input int             InpAtrPeriod     = 100;       // Average True Range Period
input double          InpAtrMult1      = 4.2;       // ATR Multiplier 1
input double          InpAtrMult2      = 3.5;       // ATR Multiplier 2
input double          InpAtrMult3      = 2.8;       // ATR Multiplier 3

input group "RSI"
input int             InpRsiPeriod     = 14;        // RSI periyodu
input double          InpRsiOb         = 70.0;      // Üst seviye
input double          InpRsiOs         = 30.0;      // Alt seviye

input group "CCI (mor çizgi = CCI MA)"
input int             InpCciPeriod     = 34;        // CCI periyodu (typical price)
input int             InpCciMaPeriod   = 21;        // CCI MA periyodu (mor çizgi, SMA)

input group "Tarama"
input bool            InpScanMarketWatch = true;    // Piyasa Gözlemi'ndeki TÜM pariteleri tara
input int             InpTimerSec        = 5;       // Tarama aralığı (sn)
input int             InpMaxSymbols      = 60;      // En fazla parite

input group "Bildirim"
input bool            InpAlert         = true;      // Alert penceresi
input bool            InpPush          = false;     // Telefon bildirimi (MT5 mobil)
input bool            InpEmail         = false;     // E-posta

input group "Emir (varsayılan: SADECE UYARI)"
input bool            InpAutoTrade     = false;     // Otomatik emir aç (DİKKAT)
input int             InpMinConf       = 80;        // Otomatik emir için minimum güven (%)
input double          InpLots          = 0.10;      // Lot
input double          InpBeAtPct       = 30.0;      // SL'yi girişe çek: TP yolunun % kaçında (0 = kapalı)
input double          InpPartialAtPct  = 50.0;      // Yarı kâr al: TP yolunun % kaçında (0 = kapalı)
input double          InpPartialPct    = 50.0;      // Kapatılacak oran (%)
input ulong           InpMagic         = 330033;    // Magic number

//--- Sonuç yapısı
struct KResult
  {
   string   symbol;
   datetime barTime;
   datetime sellSetupTime;
   datetime buySetupTime;
   double   rsi;
   double   cci;
   double   cciMa;
   double   center;
   double   atr;
   double   liveHigh;
   double   liveLow;
   datetime liveBarTime;
   int      sellStage;
   int      buyStage;
   bool     sellFire;
   bool     buyFire;
   double   sellSl;
   double   sellTp;
   double   buySl;
   double   buyTp;
   int      sellConf;
   int      buyConf;
   double   sellPeak;
   double   buyPeak;
  };

//--- Genel değişkenler
CTrade   g_trade;
string   g_fireKey[];
datetime g_fireBar[];
int      g_firedTotal = 0;

//+------------------------------------------------------------------+
//| Yapı taşları                                                     |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| Kısa zaman dilimi adı (emir yorumu için: "KANAL BUY M15")        |
//+------------------------------------------------------------------+
string TfShort(const ENUM_TIMEFRAMES tf)
  {
   string s = EnumToString(tf);          // PERIOD_M15
   StringReplace(s, "PERIOD_", "");      // M15
   return s;
  }

double OuterMult()
  {
   return MathMax(InpAtrMult1, MathMax(InpAtrMult2, InpAtrMult3));
  }

double CenterAt(const double &pr[], const int i, const int n, const int H)
  {
   if(i - H < 0) return EMPTY_VALUE;
   double sum = (H + 1) * pr[i];
   double sw  = H + 1;
   int    k   = H;
   for(int j = 1; j <= H; j++)
     {
      sum += k * pr[i - j];
      sw  += k;
      if(i + j <= n - 1)
        {
         sum += k * pr[i + j];
         sw  += k;
        }
      k--;
     }
   return sum / sw;
  }

double AtrAt(const MqlRates &r[], const int i, const int P)
  {
   if(i < P + 10) return EMPTY_VALUE;
   double sum = 0.0;
   for(int j = 0; j < P; j++)
     {
      int q = i - 10 - j;
      sum += MathMax(r[q].high, r[q - 1].close) - MathMin(r[q].low, r[q - 1].close);
     }
   return sum / P;
  }

double RsiFromAvg(const double up, const double down)
  {
   if(down == 0.0) return 100.0;
   if(up == 0.0)   return 0.0;
   return 100.0 - 100.0 / (1.0 + up / down);
  }

void RsiSeries(const double &cl[], const int n, const int period, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   if(period < 1 || n <= period) return;
   double sumU = 0.0, sumD = 0.0;
   for(int i = 1; i <= period; i++)
     {
      double ch = cl[i] - cl[i - 1];
      sumU += MathMax(ch, 0.0);
      sumD += MathMax(-ch, 0.0);
     }
   double avgU = sumU / period;
   double avgD = sumD / period;
   out[period] = RsiFromAvg(avgU, avgD);
   for(int i = period + 1; i < n; i++)
     {
      double ch = cl[i] - cl[i - 1];
      avgU = (avgU * (period - 1) + MathMax(ch, 0.0))  / period;
      avgD = (avgD * (period - 1) + MathMax(-ch, 0.0)) / period;
      out[i] = RsiFromAvg(avgU, avgD);
     }
  }

void CciSeries(const MqlRates &r[], const int n, const int period, double &out[])
  {
   double tp[];
   ArrayResize(tp, n);
   ArrayResize(out, n);
   for(int i = 0; i < n; i++)
     {
      tp[i]  = (r[i].high + r[i].low + r[i].close) / 3.0;
      out[i] = EMPTY_VALUE;
     }
   for(int i = period - 1; i < n; i++)
     {
      double sum = 0.0;
      for(int k = 0; k < period; k++) sum += tp[i - k];
      double sma = sum / period;
      double dev = 0.0;
      for(int k = 0; k < period; k++) dev += MathAbs(tp[i - k] - sma);
      dev /= period;
      out[i] = (dev != 0.0) ? (tp[i] - sma) / (0.015 * dev) : 0.0;
     }
  }

void SmaSeries(const double &src[], const int n, const int period, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = EMPTY_VALUE;
   int s = -1;
   for(int i = 0; i < n; i++)
     {
      if(src[i] != EMPTY_VALUE) { s = i; break; }
     }
   if(s < 0) return;
   for(int i = s + period - 1; i < n; i++)
     {
      double sum = 0.0;
      for(int k = 0; k < period; k++) sum += src[i - k];
      out[i] = sum / period;
     }
  }

bool SeriesCrossUp(const double &a[], const double &b[], const int idx)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || b[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE || b[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] <= b[idx - 1] && a[idx] > b[idx]);
  }

bool SeriesCrossDown(const double &a[], const double &b[], const int idx)
  {
   if(idx < 1) return false;
   if(a[idx] == EMPTY_VALUE || b[idx] == EMPTY_VALUE || a[idx - 1] == EMPTY_VALUE || b[idx - 1] == EMPTY_VALUE) return false;
   return (a[idx - 1] >= b[idx - 1] && a[idx] < b[idx]);
  }

bool RsiBeyond(const bool sell, const double v)
  {
   if(v == EMPTY_VALUE) return false;
   return sell ? (v > InpRsiOb) : (v < InpRsiOs);
  }

//+------------------------------------------------------------------+
//| Bir yön için koşullar (bar tt'de)                                |
//+------------------------------------------------------------------+
void EvalSide(const bool sell, const int tt, const int ttl, const MqlRates &r[],
              const double &cy[], const double &atr[],
              const double &rsi[], const double &cci[], const double &ma[],
              bool &brk, bool &ext, bool &ret, bool &rsiOk, bool &cciOk,
              double &extreme, double &depth, double &peak, int &setup)
  {
   const double M = OuterMult();
   setup = -1;
   brk = ext = ret = rsiOk = cciOk = false;
   depth = 0.0;
   peak = EMPTY_VALUE;
   extreme = sell ? -DBL_MAX : DBL_MAX;
   int from = MathMax(1, tt - ttl);
   int m0 = -1;
   // M0 requires both an outer-band CLOSE and an extreme RSI on that same closed bar.
   for(int b = tt; b >= from; b--)
     {
      if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE || atr[b] <= 0.0 || rsi[b] == EMPTY_VALUE) continue;
      double outer = sell ? cy[b] + M * atr[b] : cy[b] - M * atr[b];
      bool outside = sell ? r[b].close > outer : r[b].close < outer;
      bool over = sell ? rsi[b] > InpRsiOb : rsi[b] < InpRsiOs;
      if(outside && over) { m0 = b; break; }
     }
   if(m0 < 0) return;
   setup = m0;
   brk = true;
   ext = true;
   peak = rsi[m0];
   double m0Outer = sell ? cy[m0] + M * atr[m0] : cy[m0] - M * atr[m0];
   depth = sell ? (r[m0].close - m0Outer) / atr[m0] : (m0Outer - r[m0].close) / atr[m0];

   int mr = -1;
   // Option B: close at least 0.10 ATR inside the outer band, strictly after M0.
   for(int b = m0 + 1; b <= tt; b++)
     {
      if(cy[b] == EMPTY_VALUE || atr[b] == EMPTY_VALUE) continue;
      double outer = sell ? cy[b] + M * atr[b] : cy[b] - M * atr[b];
      if(sell ? r[b].close <= outer - 0.10 * atr[b] : r[b].close >= outer + 0.10 * atr[b]) { mr = b; break; }
     }
   if(mr < 0)
     {
      for(int b = m0; b <= tt; b++) if(rsi[b] != EMPTY_VALUE) peak = sell ? MathMax(peak, rsi[b]) : MathMin(peak, rsi[b]);
      for(int b = m0; b <= tt; b++) { if(sell && r[b].high > extreme) extreme = r[b].high; if(!sell && r[b].low < extreme) extreme = r[b].low; }
      return;
     }
   ret = true;
   int x = -1;
   // The RSI threshold can cross on the same closed bar that confirms the safe return.
   for(int b = mr; b <= tt; b++)
     {
      if(rsi[b - 1] == EMPTY_VALUE || rsi[b] == EMPTY_VALUE) continue;
      // Equality on the threshold belongs to the prior side; require a CLOSED bar strictly across.
      // BUY: <= 30 -> > 30; SELL: >= 70 -> < 70.
      if(sell && rsi[b - 1] >= InpRsiOb && rsi[b] < InpRsiOb) x = b;
      if(!sell && rsi[b - 1] <= InpRsiOs && rsi[b] > InpRsiOs) x = b;
     }
   bool rNowOk = rsi[tt] != EMPTY_VALUE && (sell ? rsi[tt] < InpRsiOb : rsi[tt] > InpRsiOs);
   if(x < 0 || !rNowOk)
     {
      for(int b = m0; b <= tt; b++) { if(sell && r[b].high > extreme) extreme = r[b].high; if(!sell && r[b].low < extreme) extreme = r[b].low; }
      for(int b = m0; b <= tt; b++) if(rsi[b] != EMPTY_VALUE) peak = sell ? MathMax(peak, rsi[b]) : MathMin(peak, rsi[b]);
      return;
     }
   rsiOk = true;
   int cx = -1;
   // CCI/MA may cross on the same closed bar as the RSI confirmation.
   for(int b = x; b <= tt; b++)
     {
      if(sell && SeriesCrossDown(cci, ma, b)) cx = b;
      if(!sell && SeriesCrossUp(cci, ma, b)) cx = b;
     }
   bool cNowOk = (cci[tt] != EMPTY_VALUE && ma[tt] != EMPTY_VALUE) && (sell ? cci[tt] < ma[tt] : cci[tt] > ma[tt]);
   cciOk = (cx >= 0 && cNowOk);
   int end = x;
   for(int b = m0; b <= end; b++)
     {
      if(sell && r[b].high > extreme) extreme = r[b].high;
      if(!sell && r[b].low < extreme) extreme = r[b].low;
      if(rsi[b] != EMPTY_VALUE) peak = sell ? MathMax(peak, rsi[b]) : MathMin(peak, rsi[b]);
     }
  }

int StageOf(const bool brk, const bool ext, const bool ret, const bool rsiOk, const bool cciOk)
  {
   if(!brk) return 0;
   if(!ext) return 1;
   return 2 + (ret ? 1 : 0) + (rsiOk ? 1 : 0) + (cciOk ? 1 : 0);
  }

//+------------------------------------------------------------------+
//| SL / TP                                                          |
//+------------------------------------------------------------------+
void Levels(const bool sell, const double entry, const double extreme, const double center, const double atr, double &sl, double &tp)
  {
   // Spec: stop = RSI dönüş öncesi ekstrem, hedef = KANAL3BAND merkez çizgisi.
   sl = extreme;
   tp = center;
  }

//+------------------------------------------------------------------+
//| Güven: 60 + derinlik + RSI aşırılığı + CCI farkı + R:R           |
//+------------------------------------------------------------------+
int Confidence(const bool sell, const double depth, const double peak, const double cci, const double ma,
               const double entry, const double sl, const double tp)
  {
   double dp = MathMax(0.0, MathMin(10.0, depth * 20.0));
   double rp = 0.0;
   if(peak != EMPTY_VALUE) rp = sell ? peak - InpRsiOb : InpRsiOs - peak;
   rp = MathMax(0.0, MathMin(15.0, rp));
   double cp = 0.0;
   if(cci != EMPTY_VALUE && ma != EMPTY_VALUE) cp = MathMin(5.0, MathAbs(cci - ma) / 20.0);
   double rr = 0.0;
   if(MathAbs(entry - sl) > 0.0) rr = MathAbs(tp - entry) / MathAbs(entry - sl);
   double rrp = 0.0;
   if(rr >= 2.0) rrp = 10.0;
   else if(rr >= 1.5) rrp = 7.0;
   else if(rr >= 1.0) rrp = 4.0;
   return (int)MathMin(99.0, MathFloor(60.0 + dp + rp + cp + rrp + 0.5));
  }

//+------------------------------------------------------------------+
//| Bir parite / zaman dilimi için stratejiyi çalıştır               |
//+------------------------------------------------------------------+
bool Analyze(const string sym, const ENUM_TIMEFRAMES tf, KResult &res)
  {
   const int need = MathMax(500, InpAtrPeriod + InpHalfLength + 250);
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(sym, tf, 0, need, r);
   if(n < InpAtrPeriod + InpHalfLength + 30) return false;

   double pr[], cl[];
   ArrayResize(pr, n);
   ArrayResize(cl, n);
   for(int i = 0; i < n; i++)
     {
      pr[i] = (r[i].high + r[i].low + 2.0 * r[i].close) / 4.0;
      cl[i] = r[i].close;
     }
   double rsi[], cci[], ma[];
   RsiSeries(cl, n, InpRsiPeriod, rsi);
   CciSeries(r, n, InpCciPeriod, cci);
   SmaSeries(cci, n, InpCciMaPeriod, ma);

   const int t = n - 2;   // son KAPANMIŞ mum
   double cy[], atr[];
   ArrayResize(cy, n);
   ArrayResize(atr, n);
   for(int i = 0; i < n; i++)
     {
      cy[i]  = EMPTY_VALUE;
      atr[i] = EMPTY_VALUE;
     }
   int ttl = (tf == PERIOD_M3 || tf == PERIOD_M5) ? 10 : tf == PERIOD_M15 ? 8 : tf == PERIOD_H1 ? 6 : 10;
   bool qualityOk = true;
   MqlTick qt;
   int tfSeconds = PeriodSeconds(tf);
   if(tfSeconds <= 0) tfSeconds = 900;
   datetime serverNow = TimeTradeServer();
   if(serverNow <= 0) serverNow = TimeCurrent();
   if(!SymbolInfoTick(sym, qt) || qt.bid <= 0 || qt.ask <= 0) qualityOk = false;
   else
     {
      if((serverNow - qt.time) > MathMax(30, tfSeconds * 2)) qualityOk = false;
      if((serverNow - (r[n - 1].time + tfSeconds)) > tfSeconds * 2) qualityOk = false;
      double avgSpread = 0.0;
      int spreadN = 0;
      for(int b = MathMax(0, t - 19); b <= t; b++)
        {
         if(r[b].spread > 0) { avgSpread += (double)r[b].spread; spreadN++; }
        }
      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(spreadN < 20 || avgSpread <= 0.0 || point <= 0.0) qualityOk = false;
      else
        {
         avgSpread /= spreadN;
         double currentSpreadPoints = (qt.ask - qt.bid) / point;
         if(currentSpreadPoints > 2.5 * avgSpread) qualityOk = false;
        }
     }
   for(int i = MathMax(1, t - ttl - 4); i <= t; i++)
     {
      cy[i]  = CenterAt(pr, i, n - 1, InpHalfLength);   // oluşmakta olan mum hariç
      atr[i] = AtrAt(r, i, InpAtrPeriod);
     }
   if(cy[t] == EMPTY_VALUE || atr[t] == EMPTY_VALUE) return false;

   bool sBrk, sExt, sRet, sRsi, sCci, bBrk, bExt, bRet, bRsi, bCci, pBrk, pExt, pRet, pRsi, pCci;
   double sEx, sDep, sPk, bEx, bDep, bPk, tEx, tDep, tPk;
   int sM0, bM0, pM0;
   EvalSide(true,  t, ttl, r, cy, atr, rsi, cci, ma, sBrk, sExt, sRet, sRsi, sCci, sEx, sDep, sPk, sM0);
   EvalSide(false, t, ttl, r, cy, atr, rsi, cci, ma, bBrk, bExt, bRet, bRsi, bCci, bEx, bDep, bPk, bM0);
   EvalSide(true,  t - 1, ttl, r, cy, atr, rsi, cci, ma, pBrk, pExt, pRet, pRsi, pCci, tEx, tDep, tPk, pM0);
   bool sellPrevArmed = (pBrk && pExt && pRet && pRsi && pCci);
   EvalSide(false, t - 1, ttl, r, cy, atr, rsi, cci, ma, pBrk, pExt, pRet, pRsi, pCci, tEx, tDep, tPk, pM0);
   bool buyPrevArmed = (pBrk && pExt && pRet && pRsi && pCci);

   bool sellArmed = (sBrk && sExt && sRet && sRsi && sCci);
   bool buyArmed  = (bBrk && bExt && bRet && bRsi && bCci);

   res.symbol    = sym;
   res.barTime   = r[t].time;
   res.sellSetupTime = sM0 >= 0 ? r[sM0].time : 0;
   res.buySetupTime  = bM0 >= 0 ? r[bM0].time : 0;
   res.rsi       = rsi[t];
   res.cci       = cci[t];
   res.cciMa     = ma[t];
   res.center    = cy[t];
   res.atr       = atr[t];
   res.liveHigh  = r[n - 1].high;
   res.liveLow   = r[n - 1].low;
   res.liveBarTime = r[n - 1].time;
   res.sellStage = StageOf(sBrk, sExt, sRet, sRsi, sCci);
   res.buyStage  = StageOf(bBrk, bExt, bRet, bRsi, bCci);
   res.sellFire  = (qualityOk && sellArmed && !sellPrevArmed && SeriesCrossDown(cci, ma, t));
   res.buyFire   = (qualityOk && buyArmed && !buyPrevArmed && SeriesCrossUp(cci, ma, t));
   res.sellPeak  = sPk;
   res.buyPeak   = bPk;

   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(bid <= 0.0) bid = r[n - 1].close;
   if(ask <= 0.0) ask = r[n - 1].close;

   double sl, tp;
   Levels(true, bid, sEx, cy[t], atr[t], sl, tp);
   res.sellSl   = sl;
   res.sellTp   = tp;
   res.sellConf = Confidence(true, sDep, sPk, cci[t], ma[t], bid, sl, tp);
   Levels(false, ask, bEx, cy[t], atr[t], sl, tp);
   res.buySl    = sl;
   res.buyTp    = tp;
   res.buyConf  = Confidence(false, bDep, bPk, cci[t], ma[t], ask, sl, tp);
   double rrSell = MathAbs(res.sellSl - bid) > 0.0 ? MathAbs(res.sellTp - bid) / MathAbs(res.sellSl - bid) : 0.0;
   res.sellFire = res.sellFire && rrSell >= 1.0 && res.sellSl > bid && res.sellTp < bid;
   double rrBuy = MathAbs(res.buySl - ask) > 0.0 ? MathAbs(res.buyTp - ask) / MathAbs(res.buySl - ask) : 0.0;
   res.buyFire = res.buyFire && rrBuy >= 1.0 && res.buySl < ask && res.buyTp > ask;
   return true;
  }

//+------------------------------------------------------------------+
//| Yardımcılar                                                      |
//+------------------------------------------------------------------+
bool AlreadyFired(const string key, const datetime bar)
  {
   int total = ArraySize(g_fireKey);
   for(int i = 0; i < total; i++)
     {
      if(g_fireKey[i] == key)
        {
         if(g_fireBar[i] == bar) return true;
         g_fireBar[i] = bar;
         return false;
        }
     }
   ArrayResize(g_fireKey, total + 1);
   ArrayResize(g_fireBar, total + 1);
   g_fireKey[total] = key;
   g_fireBar[total] = bar;
   return false;
  }

double NormalizeLots(const string sym, const double lots)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) step = 0.01;
   double v = MathFloor(lots / step + 0.5) * step;
   if(v < vmin) v = vmin;
   if(v > vmax) v = vmax;
   return NormalizeDouble(v, 2);
  }

bool HasPosition(const string sym)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == sym && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

bool OpenTrade(const string sym, const bool sell, double sl, double tp, const string comment)
  {
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double lots   = NormalizeLots(sym, InpLots);
   double price  = sell ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);
   bool ok = sell ? g_trade.Sell(lots, sym, price, sl, tp, comment)
                  : g_trade.Buy(lots, sym, price, sl, tp, comment);
   if(!ok)
      Print("KANAL emir hatası ", sym, ": ", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription());
   return ok;
  }

void OnSignal(const string sym, const ENUM_TIMEFRAMES tf, const bool sell, const KResult &res)
  {
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double sl   = sell ? res.sellSl : res.buySl;
   double tp   = sell ? res.sellTp : res.buyTp;
   int    conf = sell ? res.sellConf : res.buyConf;
   double pk   = sell ? res.sellPeak : res.buyPeak;
   string side = sell ? "SELL" : "BUY";
   string msg = StringFormat("KANAL SİNYAL: %s %s %s | güven %%%d | RSI %s %.1f -> %.1f | CCI %.0f / MA %.0f | SL %s TP(merkez) %s",
                             sym, EnumToString(tf), side, conf, (sell ? "tepe" : "dip"), pk, res.rsi, res.cci, res.cciMa,
                             DoubleToString(sl, digits), DoubleToString(tp, digits));
   Print(msg);
   if(InpAlert) Alert(msg);
   if(InpPush)  SendNotification(msg);
   if(InpEmail) SendMail("KANAL SİNYAL " + sym, msg);
   g_firedTotal++;

   if(InpAutoTrade && conf < InpMinConf)
      Print("KANAL: ", sym, " güven %", conf, " < %", InpMinConf, " - otomatik emir açılmadı (yalnızca uyarı).");
   if(InpAutoTrade && conf >= InpMinConf)
     {
      if(HasPosition(sym))
         Print("KANAL: ", sym, " için açık pozisyon var, yeni emir açılmadı.");
      else
         OpenTrade(sym, sell, sl, tp, "KANAL " + side + " " + TfShort(tf));
     }
  }

//+------------------------------------------------------------------+
//| Bu pozisyonda daha önce kısmi kapanış yapıldı mı? (geçmişte OUT) |
//+------------------------------------------------------------------+
bool PartialDone(const ulong posId)
  {
   if(!HistorySelectByPosition(posId)) return false;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Kâr yönetimi: %InpBeAtPct'te SL girişe, %InpPartialAtPct'te yarı  |
//| kâr al (TP yolunun yüzdesi)                                      |
//+------------------------------------------------------------------+
void ManageBreakeven()
  {
   if(InpBeAtPct <= 0.0 && InpPartialAtPct <= 0.0) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double cur  = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      long   pid  = PositionGetInteger(POSITION_IDENTIFIER);
      string sym  = PositionGetString(POSITION_SYMBOL);
      bool   buy  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      if(tp <= 0.0) continue;
      double dist = buy ? (tp - open) : (open - tp);
      if(dist <= 0.0) continue;
      double prog = (buy ? (cur - open) : (open - cur)) / dist * 100.0;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

      // 1) SL girişe
      bool atBe = (sl > 0.0) && (buy ? (sl >= open) : (sl <= open));
      if(InpBeAtPct > 0.0 && prog >= InpBeAtPct && !atBe)
        {
         if(g_trade.PositionModify(ticket, NormalizeDouble(open, digits), tp))
            Print("KANAL: ", sym, " SL girişe çekildi (TP yolunun %", DoubleToString(prog, 0), ")");
         else
            Print("KANAL: ", sym, " SL girişe çekilemedi: ", g_trade.ResultRetcodeDescription());
        }

      // 2) Yarı kâr al
      if(InpPartialAtPct > 0.0 && prog >= InpPartialAtPct && !PartialDone((ulong)pid))
        {
         double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
         double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
         if(step <= 0.0) step = 0.01;
         double part = MathFloor(vol * InpPartialPct / 100.0 / step + 1e-9) * step;
         if(part < vmin || vol - part < vmin - 1e-9)
            continue;   // lot bölünemeyecek kadar küçük
         if(g_trade.PositionClosePartial(ticket, NormalizeDouble(part, 2)))
            Print("KANAL: ", sym, " yarı kâr alındı: ", DoubleToString(part, 2), " lot kapatıldı (TP yolunun %", DoubleToString(prog, 0), ")");
         else
            Print("KANAL: ", sym, " kısmi kapanış başarısız: ", g_trade.ResultRetcodeDescription());
        }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpHalfLength < 1 || InpAtrPeriod < 1)
      return INIT_PARAMETERS_INCORRECT;
   if(!InpUseM3 && !InpUseM5 && !InpUseM15 && !InpUseH1)
     {
      Alert("KANAL: En az bir zaman dilimi seçin (M3 / M5 / M15 / H1).");
      return INIT_PARAMETERS_INCORRECT;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   EventSetTimer(MathMax(1, InpTimerSec));
   Comment("KANAL Strateji v2 başlatıldı...\nMod: ", (InpAutoTrade ? "OTOMATİK EMİR" : "SADECE UYARI"));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTick()
  {
  }

//+------------------------------------------------------------------+
//| Zamanlayıcı: seçili zaman dilimlerinde tüm pariteleri tara       |
//+------------------------------------------------------------------+
string KanalLockPrefix(const string sym)
  {
   string clean = sym;
   StringReplace(clean, ".", "_");
   StringReplace(clean, "/", "_");
   StringReplace(clean, "#", "_");
   return "JRV5_" + clean;
  }

void ClearKanalLock(const string sym)
  {
   string p = KanalLockPrefix(sym);
   GlobalVariableDel(p + "_A"); GlobalVariableDel(p + "_S");
   GlobalVariableDel(p + "_L"); GlobalVariableDel(p + "_T"); GlobalVariableDel(p + "_M0"); GlobalVariableDel(p + "_CT");
  }

void SetKanalLock(const string sym, const bool sell, const datetime m0, const double sl, const double tp)
  {
   string p = KanalLockPrefix(sym);
   GlobalVariableSet(p + "_S", sell ? -1.0 : 1.0);
   GlobalVariableSet(p + "_L", sl);
   GlobalVariableSet(p + "_T", tp);
   GlobalVariableSet(p + "_M0", (double)m0);
   datetime created = TimeTradeServer();
   if(created <= 0) created = TimeCurrent();
   GlobalVariableSet(p + "_CT", (double)created);
   GlobalVariableSet(p + "_A", 1.0); // terminal Global Variables survive EA/terminal restart
  }

bool RefreshKanalLock(const string sym, KResult &rows[], const bool &valid[], const int nrows)
  {
   string p = KanalLockPrefix(sym);
   if(!GlobalVariableCheck(p + "_A")) return false;
   double side = GlobalVariableGet(p + "_S");
   double sl = GlobalVariableGet(p + "_L");
   double tp = GlobalVariableGet(p + "_T");
   datetime m0 = (datetime)GlobalVariableGet(p + "_M0");
   datetime createdAt = (datetime)GlobalVariableGet(p + "_CT");
   double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   double liveHigh = bid, liveLow = ask;
   for(int i = 0; i < nrows; i++)
     {
      if(!valid[i] || rows[i].liveBarTime <= createdAt) continue;
      liveHigh = MathMax(liveHigh, rows[i].liveHigh);
      liveLow = MathMin(liveLow, rows[i].liveLow);
     }
   bool touched = side > 0 ? (bid >= tp || liveHigh >= tp || bid <= sl || liveLow <= sl)
                           : (ask <= tp || liveLow <= tp || ask >= sl || liveHigh >= sl);
   bool reverseM0 = false;
   for(int i = 0; i < nrows; i++)
     {
      if(!valid[i]) continue;
      if(side > 0 && rows[i].sellStage >= 2 && rows[i].sellSetupTime > m0) reverseM0 = true;
      if(side < 0 && rows[i].buyStage >= 2 && rows[i].buySetupTime > m0) reverseM0 = true;
     }
   if(touched || reverseM0)
     {
      ClearKanalLock(sym);
      return false;
     }
   return true;
  }

int TfRank(const ENUM_TIMEFRAMES tf)
  {
   if(tf == PERIOD_M3) return 3;
   if(tf == PERIOD_M5) return 5;
   if(tf == PERIOD_M15) return 15;
   if(tf == PERIOD_H1) return 60;
   return (int)tf;
  }

void OnTimer()
  {
   ManageBreakeven();

   ENUM_TIMEFRAMES tfs[4];
   int ntf = 0;
   if(InpUseM3)  { tfs[ntf] = PERIOD_M3;  ntf++; }
   if(InpUseM5)  { tfs[ntf] = PERIOD_M5;  ntf++; }
   if(InpUseM15) { tfs[ntf] = PERIOD_M15; ntf++; }
   if(InpUseH1)  { tfs[ntf] = PERIOD_H1;  ntf++; }

   int total = InpScanMarketWatch ? SymbolsTotal(true) : 1;
   int limit = MathMin(total, InpMaxSymbols);
   int scanned = 0;
   string watchList = "";

   for(int s = 0; s < limit; s++)
     {
      string sym = InpScanMarketWatch ? SymbolName(s, true) : _Symbol;
      KResult rows[4];
      bool valid[4];
      for(int k = 0; k < 4; k++) valid[k] = false;
      for(int k = 0; k < ntf; k++)
        {
         valid[k] = Analyze(sym, tfs[k], rows[k]);
         if(valid[k]) scanned++;
        }

      bool conflict = false;
      for(int a = 0; a < ntf; a++)
        {
         if(!valid[a]) continue;
         for(int b = a + 1; b < ntf; b++)
           {
            if(!valid[b]) continue;
            if((rows[a].buyStage == 5 && rows[b].sellStage == 5) ||
               (rows[a].sellStage == 5 && rows[b].buyStage == 5)) conflict = true;
           }
        }
      // Uyumlu daha yüksek TF güven puanına +10 ekler.
      for(int a = 0; a < ntf; a++)
        {
         if(!valid[a]) continue;
         bool higherBuy = false, higherSell = false;
         for(int b = 0; b < ntf; b++)
           {
            if(!valid[b] || TfRank(tfs[b]) <= TfRank(tfs[a])) continue;
            if(rows[b].buyStage == 5) higherBuy = true;
            if(rows[b].sellStage == 5) higherSell = true;
           }
         if(higherBuy) rows[a].buyConf = (int)MathMin(99, rows[a].buyConf + 10);
         if(higherSell) rows[a].sellConf = (int)MathMin(99, rows[a].sellConf + 10);
        }
      bool locked = RefreshKanalLock(sym, rows, valid, ntf);
      for(int k = 0; k < ntf; k++)
        {
         if(!valid[k]) continue;
         string tfs_ = IntegerToString((int)tfs[k]);
         if(!locked && !conflict && rows[k].sellFire && !AlreadyFired(sym + "|S|" + tfs_, rows[k].sellSetupTime))
           {
            SetKanalLock(sym, true, rows[k].sellSetupTime, rows[k].sellSl, rows[k].sellTp);
            OnSignal(sym, tfs[k], true, rows[k]);
            locked = true;
           }
         if(!locked && !conflict && rows[k].buyFire && !AlreadyFired(sym + "|B|" + tfs_, rows[k].buySetupTime))
           {
            SetKanalLock(sym, false, rows[k].buySetupTime, rows[k].buySl, rows[k].buyTp);
            OnSignal(sym, tfs[k], false, rows[k]);
            locked = true;
           }
         if(rows[k].sellStage >= 2) watchList += sym + " " + EnumToString(tfs[k]) + " SATIŞ " + IntegerToString(rows[k].sellStage) + "/5\n";
         if(rows[k].buyStage >= 2)  watchList += sym + " " + EnumToString(tfs[k]) + " ALIŞ "  + IntegerToString(rows[k].buyStage)  + "/5\n";
        }
      if(conflict) watchList += sym + " TF ÇAKIŞMASI · EMİR KİLİTLİ\n";
     }

   Comment("KANAL Strateji v3.23 | taranan: ", scanned, " | sinyal: ", g_firedTotal, " | ",
           (InpAutoTrade ? "OTOMATİK EMİR (güven >= %" + IntegerToString(InpMinConf) + ")" : "SADECE UYARI"),
           "\n", (watchList == "" ? "Yaklaşan kurulum yok" : "Yaklaşan kurulumlar (bant dışı + RSI aşırı bölge):\n" + watchList));
  }
//+------------------------------------------------------------------+
